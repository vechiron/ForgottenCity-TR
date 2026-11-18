// UE4 pak okuyucu (`pakAc`) ve yazıcı (`pakYaz`): sürüm 10/11, sıkıştırmasız, şifresiz indeks.
// Neden kendi okuyucumuz: UnrealPak/repak kurulumuna bağımlı olmadan, her koşumda
// oyunun gerçek durumunu ölçebilmek için. Sıkıştırmalı ya da şifreli pak görürse
// sessizce yanlış sonuç vermez, hata fırlatır. Okuyucu oyun dosyasına yazmaz; yazıcı yalnızca bellekte
// bir Buffer döndürür (diske yazmak çağıranın işi).
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';

const KUNYE = 221;          // 16 GUID + 1 şifreli + 4 sihir + 4 sürüm + 8 ofset + 8 boyut + 20 SHA1 + 5*32 sıkıştırma adı
const SIHIR = 0x5A6F12E1;
const DOSYA_BASLIGI = 53;   // pak içindeki giriş başlığı: 8+8+8 (ofset, sıkıştırılmış, açılmış) + 4 yöntem + 20 SHA1 + 1 şifreli + 4 blok boyutu

function fstr(b, o) {       // UE FString: [metin, yeniOfset]
  const n = b.readInt32LE(o); o += 4;
  if (n === 0) return ['', o];
  if (n > 0) return [b.toString('latin1', o, o + n - 1), o + n];
  const m = -n;
  return [b.toString('utf16le', o, o + (m - 1) * 2), o + m * 2];
}

/**
 * Oyunun `Content/Paks/` klasöründeki dosya adlarından OYUNUN KENDİ paklarını seçer (sıralı): `.pak` ile biten ama `_P.pak` ile
 * BİTMEYEN adlar. `_P.pak` yama paketidir (bizimki dahil); oyunun paklarına karışırsa kaynak metin yamasız İngilizce olmaz ve
 * bozuk bir yama paketi aracı çökertir. SAF: ad listesi alır, diske bakmaz. Oyunun paklarını okuyan her araç adları buradan
 * süzer, kopya filtre yazılmaz (`tools/yama-uret.mjs --sina` F bloğu hem bu fonksiyonu hem de üç aracın onu çağırdığını sınar).
 * Harfe duyarlı: `_p.pak` ve `.PAK` ayrı ele alınmaz (UE'nin eki harf duyarlı sayıp saymadığı ÖLÇÜLMEDİ, testte pinli değil).
 */
export function oyunPakAdlari(adlar) {
  return adlar.filter(a => a.endsWith('.pak') && !a.endsWith('_P.pak')).sort();
}

export function pakAc(yol) {
  const fd = openSync(yol, 'r');
  const boyut = fstatSync(fd).size;
  const oku = (ofset, uzunluk) => {
    const b = Buffer.alloc(uzunluk);
    let t = 0;
    while (t < uzunluk) {
      const n = readSync(fd, b, t, uzunluk - t, ofset + t);
      if (n <= 0) throw new Error(`${yol}: beklenmedik dosya sonu (ofset ${ofset + t})`);
      t += n;
    }
    return b;
  };

  const k = oku(boyut - KUNYE, KUNYE);
  if (k.readUInt32LE(17) !== SIHIR) throw new Error(`${yol}: künye sihirli sayısı tutmadı (pak değil ya da farklı sürüm)`);
  const surum = k.readUInt32LE(21);
  const sifreliIndeks = k[16] === 1;
  if (sifreliIndeks) throw new Error(`${yol}: indeks şifreli, AES anahtarı gerekir`);
  if (surum < 10 || surum > 11) throw new Error(`${yol}: pak sürümü ${surum}; bu okuyucu yalnızca 10/11 bilir`);
  const indeksOfset = Number(k.readBigUInt64LE(25));
  const indeksBoyut = Number(k.readBigUInt64LE(33));
  const indeksSha1 = Buffer.from(k.subarray(41, 61));    // künyedeki birincil indeks SHA1'i
  const sikistirmaAdlari = [];
  for (let i = 0; i < 5; i++) {
    const ad = k.toString('ascii', 61 + i * 32, 61 + (i + 1) * 32).replace(/\0.*$/s, '');
    if (ad) sikistirmaAdlari.push(ad);
  }

  // --- birincil indeks ---
  const idx = oku(indeksOfset, indeksBoyut);
  let p = 0;
  let baglamaNoktasi;
  [baglamaNoktasi, p] = fstr(idx, p);
  const girisSayisi = idx.readInt32LE(p); p += 4;
  const tohum = idx.readBigUInt64LE(p); p += 8;        // yol karması tohumu
  const yolHashVar = idx.readUInt32LE(p); p += 4;
  let yolHashOfset = 0, yolHashBoyut = 0, yolHashSha1 = null;
  if (yolHashVar) { yolHashOfset = Number(idx.readBigInt64LE(p)); yolHashBoyut = Number(idx.readBigInt64LE(p + 8)); yolHashSha1 = Buffer.from(idx.subarray(p + 16, p + 36)); p += 8 + 8 + 20; }
  const tamDizinVar = idx.readUInt32LE(p) !== 0; p += 4;
  let tamOfset = 0, tamBoyut = 0, tamSha1 = null;
  if (tamDizinVar) { tamOfset = Number(idx.readBigInt64LE(p)); tamBoyut = Number(idx.readBigInt64LE(p + 8)); tamSha1 = Buffer.from(idx.subarray(p + 16, p + 36)); p += 8 + 8 + 20; }
  const kodlananBoyut = idx.readInt32LE(p); p += 4;
  const kodlanan = idx.subarray(p, p + kodlananBoyut);

  function girisCoz(o) {
    const bayrak = kodlanan.readUInt32LE(o); o += 4;
    const yontem = (bayrak >>> 23) & 0x3f;
    const sifreli = ((bayrak >>> 22) & 1) === 1;
    let ofset, acilmis;
    if ((bayrak >>> 31) & 1) { ofset = kodlanan.readUInt32LE(o); o += 4; } else { ofset = Number(kodlanan.readBigUInt64LE(o)); o += 8; }
    if ((bayrak >>> 30) & 1) { acilmis = kodlanan.readUInt32LE(o); o += 4; } else { acilmis = Number(kodlanan.readBigUInt64LE(o)); o += 8; }
    return { ofset, boyut: acilmis, yontem, sifreli };
  }

  let onbellek = null, klasorOnbellek = null;
  /** Bütün dosyalar: [{yol, kodOfset, ofset, boyut, yontem, sifreli}] (`kodOfset`: kodlanmış giriş tablosundaki konum, yol karması kaydıyla eşleşir) */
  function liste() {
    if (onbellek) return onbellek;
    if (!tamDizinVar) throw new Error(`${yol}: tam dizin indeksi yok, dosya adları çıkarılamaz`);
    const tam = oku(tamOfset, tamBoyut);
    let q = 0;
    const dizinSayisi = tam.readInt32LE(q); q += 4;
    const sonuc = [], klasorler = [];
    for (let d = 0; d < dizinSayisi; d++) {
      let dizin; [dizin, q] = fstr(tam, q);
      dizin = dizin.replace(/^\/+/, '');
      const dosyaSayisi = tam.readInt32LE(q); q += 4;
      klasorler.push({ dizin, dosyaSayisi });
      for (let f = 0; f < dosyaSayisi; f++) {
        let ad; [ad, q] = fstr(tam, q);
        const kodOfset = tam.readInt32LE(q); q += 4;
        sonuc.push({ yol: dizin + ad, kodOfset, ...girisCoz(kodOfset) });
      }
    }
    if (sonuc.length !== girisSayisi) throw new Error(`${yol}: künyedeki giriş sayısı (${girisSayisi}) ile listelenen (${sonuc.length}) tutmuyor`);
    onbellek = sonuc; klasorOnbellek = klasorler;
    return sonuc;
  }

  /** Tam dizindeki bütün klasör satırları: [{dizin, dosyaSayisi}] (`dizin` başında "/" olmadan, sonunda "/" ile; kök = ''). Dosyasız ara klasörler de var. */
  function klasorler() { liste(); return klasorOnbellek; }

  /** Bir girişin içeriğini döndürür. Başlıktaki boyut listeyle tutmazsa hata fırlatır. */
  function icerik(g) {
    if (g.yontem !== 0 || g.sifreli) throw new Error(`${g.yol}: sıkıştırmalı ya da şifreli, desteklenmiyor`);
    const b = oku(g.ofset, DOSYA_BASLIGI);
    const sikistirilmis = Number(b.readBigUInt64LE(8));
    const acilmis = Number(b.readBigUInt64LE(16));
    const yontem = b.readUInt32LE(24);
    if (yontem !== 0 || sikistirilmis !== g.boyut || acilmis !== g.boyut) {
      throw new Error(`${g.yol}: dosya başlığı listeyle tutmuyor (başlık ${sikistirilmis}/${acilmis}/${yontem}, liste ${g.boyut})`);
    }
    return g.boyut ? oku(g.ofset + DOSYA_BASLIGI, g.boyut) : Buffer.alloc(0);
  }

  /** Yol karması indeksi: [{ karma: BigInt, kodOfset }] (dosya sırasıyla). Yoksa boş dizi. */
  function yolKarmalari() {
    if (!yolHashVar) return [];
    const t = oku(yolHashOfset, yolHashBoyut);
    const n = t.readInt32LE(0);
    const sonuc = [];
    for (let i = 0; i < n; i++) sonuc.push({ karma: t.readBigUInt64LE(4 + i * 12), kodOfset: t.readInt32LE(12 + i * 12) });
    return sonuc;
  }

  /**
   * Yol karması bloğunun sonundaki "budanmış klasör tablosu" (karma tablosundan hemen sonra gelir; ayrıntı:
   * docs/oyun-haritasi.md "Yama yolu"): u32 klasör sayısı | her klasör için FString ad, i32 dosya sayısı, dosya başına
   * FString ad + i32 kodOfset. Dönen: [{ dizin, dosyalar: [{ ad, kodOfset }] }] (dosya sırasıyla; `dizin` ham, FString olduğu gibi).
   * Tablo bloğu TAM tüketmiyorsa hata fırlatır (yapı denetimi). Yol karması yoksa boş dizi.
   */
  function budanmisDizin() {
    if (!yolHashVar) return [];
    const t = oku(yolHashOfset, yolHashBoyut);
    const n = t.readInt32LE(0);
    let q = 4 + n * 12;
    const dizinSayisi = t.readInt32LE(q); q += 4;
    const sonuc = [];
    for (let d = 0; d < dizinSayisi; d++) {
      let dizin; [dizin, q] = fstr(t, q);
      const dosyaSayisi = t.readInt32LE(q); q += 4;
      const dosyalar = [];
      for (let f = 0; f < dosyaSayisi; f++) {
        let ad; [ad, q] = fstr(t, q);
        dosyalar.push({ ad, kodOfset: t.readInt32LE(q) }); q += 4;
      }
      sonuc.push({ dizin, dosyalar });
    }
    if (q !== t.length) throw new Error(`${yol}: yol karması bloğunda klasör tablosundan sonra ${t.length - q} bayt artık var (blok ${t.length} bayt)`);
    return sonuc;
  }

  return {
    yol, surum, boyut, sifreliIndeks, sikistirmaAdlari, baglamaNoktasi, girisSayisi, tamDizinVar, tohum,
    indeksOfset, indeksBoyut, indeksSha1, yolHashOfset, yolHashBoyut, yolHashSha1, tamOfset, tamBoyut, tamSha1,
    liste, klasorler, icerik, yolKarmalari, budanmisDizin,
    bul: (re) => liste().filter(g => re.test(g.yol)),
    kapat: () => closeSync(fd),
  };
}

// ---------------------------------------------------------------- yazıcı
const M64 = (1n << 64n) - 1n;
const FNV_TABAN = 0xcbf29ce484222325n;
const FNV_CARPAN = 0x100000001b3n;
export const VARSAYILAN_TOHUM = 0xFC1A2B3Cn;

/**
 * Pak sürüm 11 yol karması: FNV-1a 64 bit, küçük harfli, bağlama noktasına göre göreli yol, UTF-16LE baytları,
 * başlangıç değeri FNV tabanı + tohum. "Göreli yol" = klasör + dosya adının TAMAMI (yalnız ad değil). Oyunun `pakchunk0` ve
 * `pakchunk1` dosyalarının BÜTÜN girişlerinde uydu (12.11.2026 ölçüldü; `pakchunk0`da 11 klasör derinliğine kadar). Karşı testler:
 * yalnız ad hash'lenince ya da küçültme atılınca hiçbiri tutmuyor.
 */
export function yolKarmasi(goreliYol, tohum) {
  let h = (FNV_TABAN + BigInt(tohum)) & M64;
  for (const b of Buffer.from(goreliYol.toLowerCase(), 'utf16le')) { h ^= BigInt(b); h = (h * FNV_CARPAN) & M64; }
  return h;
}

// "Budanmış klasör tablosu" kuralı (12.11.2026, oyunun `pakchunk0`ında ölçüldü; docs/oyun-haritasi.md "Yama yolu"): tabloya yalnız
// bu uzantılı dosyalar girer. Büyük/küçük harf duyarlılığı ölçülemedi (gerçek paklarda büyük harfli uzantı yok): duyarsız seçildi.
const BUDANMIS_UZANTI = /\.(ini|icu|cfu|res|nrm|brk|locmeta|locres|uplugin|upluginmanifest)$/i;
const kucuk = (a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };

/**
 * Budanmış klasör tablosunun kuralı: [{yol, kodOfset}] → [{dizin, dosyalar:[{ad, kodOfset}]}] (okuyucunun `budanmisDizin()` biçimi).
 * Tabloya uzantısı beyaz listede olan dosyalar girer, klasör adı ham ("a/b/", kök "/"); tablodaki her klasörün BÜTÜN üst klasörleri
 * (kök "/" dahil) 0 dosyalı olarak bulunur. Beyaz listede dosya yoksa tablo boştur (kök de yok).
 * `.uplugin` kuralı (12.11.2026 ölçüldü): uzantısı `.uplugin` olan bir dosyanın klasörü U ise `U/Content/` ve altında dosya taşıyan
 * bütün klasörler de (ara klasörler dahil, `U/Content/`a kadar kapanış) 0 dosyalı girer. Gerçek `pakchunk0`da bu kural + yukarıdaki
 * kural = okunan tablonun klasör kümesi, 242 ↔ 242, iki yönde fark 0 (eksik 47 klasörün tamamı bu kuraldandı); `pakchunk1`de ikisi de boş.
 * Doğrulanmadı: kuralın genel mi yoksa bu oyunun yapımcı ayarı mı olduğu (yalnız iki pakta bakıldı) · motorun tabloya baktığı.
 * Sıra: dosyalı klasörler küçük harfli sıralı, içlerinde dosyalar `kodOfset` artan (ikisi de `pakchunk0`da istisnasız tuttu); 0 dosyalı
 * atalar sonda, kök başta, ardından küçük harfli sıralı. Gerçek pakta atalar harita sırasında (rastgele görünüyor) durur,
 * o sıra ÜRETİLEMİYOR; motora etkisi yok varsayıldı (ölçülmedi).
 */
export function budanmisKume(dosyalar) {
  const dosyali = new Map();
  for (const f of dosyalar) {
    const parca = f.yol.split('/'); const ad = parca.pop();
    if (!BUDANMIS_UZANTI.test(ad)) continue;
    const d = parca.length ? parca.join('/') + '/' : '/';
    if (!dosyali.has(d)) dosyali.set(d, []);
    dosyali.get(d).push({ ad, kodOfset: f.kodOfset });
  }
  if (dosyali.size === 0) return [];
  const atalar = new Set(['/']);
  for (const d of dosyali.keys()) {
    const p = d.split('/').filter(Boolean);
    for (let n = 1; n < p.length; n++) atalar.add(p.slice(0, n).join('/') + '/');
  }
  // `.uplugin` kuralı: U/Content/ ve altında dosya taşıyan klasörlerin U/Content/'a kadar kapanışı.
  const ustler = new Set(dosyalar.map(f => { const p = f.yol.split('/'); p.pop(); return p.length ? p.join('/') + '/' : '/'; }));
  for (const [d, l] of dosyali) {
    if (!l.some(x => /\.uplugin$/i.test(x.ad))) continue;
    const c = (d === '/' ? '' : d) + 'Content/';
    const cn = c.split('/').filter(Boolean).length;
    for (const u of ustler) {
      if (u !== c && !u.startsWith(c)) continue;
      const p = u.split('/').filter(Boolean);
      for (let n = cn; n <= p.length; n++) atalar.add(p.slice(0, n).join('/') + '/');
    }
  }
  for (const d of dosyali.keys()) atalar.delete(d);
  const sonuc = [...dosyali.keys()].sort(kucuk).map(dizin => ({ dizin, dosyalar: dosyali.get(dizin).sort((a, b) => a.kodOfset - b.kodOfset) }));
  const atalarSirali = [...atalar].sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : kucuk(a, b)));
  for (const dizin of atalarSirali) sonuc.push({ dizin, dosyalar: [] });
  return sonuc;
}

const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const sha1 = (b) => createHash('sha1').update(b).digest();
const fstrAscii = (s) => Buffer.concat([i32(s.length + 1), Buffer.from(s, 'latin1'), Buffer.alloc(1)]);
const U32_AZAMI = 0xFFFFFFFF;

/**
 * Sürüm 11 pak yazar: sıkıştırmasız, şifresiz; yol karması indeksi + tam dizin indeksi (oyunun kendi paklarındaki gibi).
 * @param {{baglama?:string, tohum?:bigint|number, dosyalar:{yol:string, veri:Buffer}[]}} g
 *   `yol`: bağlama noktasına göre göreli, `/` ayraçlı, yalnız ASCII (örn. "ModernStoryteller01/Content/.../Game.locres").
 * @returns {Buffer} pak dosyasının tamamı
 * Dosya sırası korunur. Tam dizinde her dosyanın bütün üst klasörleri (dosyasız olsa da) ve kök "/" ayrı satır olarak yazılır
 * (oyunun büyük pakında dosyasız 705 klasör satırı var; motor klasör listelerken bu satırlara bakar).
 * 4 GiB'ı aşan dosya/ofset desteklenmez (hata fırlatır).
 */
export function pakYaz({ baglama = '../../../', tohum = VARSAYILAN_TOHUM, dosyalar }) {
  const gorulen = new Set();
  for (const f of dosyalar) {
    if (!/^[\x21-\x7e]+$/.test(f.yol) || f.yol.startsWith('/') || f.yol.endsWith('/') || f.yol.includes('//')) throw new Error(`pak yazıcı: geçersiz yol "${f.yol}" (göreli, yalnız ASCII, "/" ile başlamaz ya da bitmez)`);
    if (gorulen.has(f.yol.toLowerCase())) throw new Error(`pak yazıcı: yol iki kez var (büyük/küçük harf duyarsız): ${f.yol}`);
    gorulen.add(f.yol.toLowerCase());
    if (!Buffer.isBuffer(f.veri)) throw new Error(`pak yazıcı: ${f.yol} için veri Buffer değil`);
  }
  // 1) veri bölümü: her kayıt 53 baytlık başlık + veri, arka arkaya
  const kayitlar = []; const kodlanan = []; let ofset = 0;
  for (const f of dosyalar) {
    const boyut = f.veri.length;
    if (ofset > U32_AZAMI || boyut > U32_AZAMI) throw new Error(`pak yazıcı: ${f.yol} 4 GiB sınırını aşıyor`);
    const baslik = Buffer.alloc(DOSYA_BASLIGI);           // ofset 0 (8) | boyut (8) | açılmış boyut (8) | yöntem 0 (4) | SHA1 (20) | şifreli 0 (1) | blok boyutu 0 (4)
    baslik.writeBigUInt64LE(BigInt(boyut), 8); baslik.writeBigUInt64LE(BigInt(boyut), 16); sha1(f.veri).copy(baslik, 28);
    kayitlar.push(baslik, f.veri);
    const k = Buffer.alloc(12); k.writeUInt32LE(0xE0000000, 0); k.writeUInt32LE(ofset, 4); k.writeUInt32LE(boyut, 8);   // 32 bit ofset/boyut/sıkıştırılmış boyut, yöntem 0
    kodlanan.push(k);
    ofset += DOSYA_BASLIGI + boyut;
  }
  const veriBolumu = Buffer.concat(kayitlar);
  const kodlananBuf = Buffer.concat(kodlanan);
  // 2) yol karması indeksi: sayı | (karma u64, kodlanmış ofset i32)* | budanmış klasör tablosu (boşsa yalnız sayı 0)
  const yh = [i32(dosyalar.length)];
  dosyalar.forEach((f, i) => yh.push(u64(yolKarmasi(f.yol, tohum)), i32(i * 12)));
  const budanmis = budanmisKume(dosyalar.map((f, i) => ({ yol: f.yol, kodOfset: i * 12 })));
  yh.push(u32(budanmis.length));
  for (const { dizin, dosyalar: bd } of budanmis) {
    yh.push(fstrAscii(dizin), i32(bd.length));
    for (const x of bd) yh.push(fstrAscii(x.ad), i32(x.kodOfset));
  }
  const yolHashBuf = Buffer.concat(yh);
  // 3) tam dizin indeksi: sayı | (klasör fstr, dosya sayısı, (ad fstr, kodlanmış ofset i32)*)*
  const dizinler = new Map([['/', []]]);
  dosyalar.forEach((f, i) => {
    const parca = f.yol.split('/'); const ad = parca.pop();
    for (let n = 1; n <= parca.length; n++) { const d = parca.slice(0, n).join('/') + '/'; if (!dizinler.has(d)) dizinler.set(d, []); }
    const d = parca.length ? parca.join('/') + '/' : '/';
    dizinler.get(d).push({ ad, kodOfset: i * 12 });
  });
  const td = [i32(dizinler.size)];
  for (const [d, liste] of dizinler) {
    td.push(fstrAscii(d), i32(liste.length));
    for (const x of liste) td.push(fstrAscii(x.ad), i32(x.kodOfset));
  }
  const tamDizinBuf = Buffer.concat(td);
  // 4) birincil indeks (ofsetler: yol karması ve tam dizin, birincilin hemen ardından)
  const birincilOfset = veriBolumu.length;
  const birincilBoyu = fstrAscii(baglama).length + 4 + 8 + 4 + 36 + 4 + 36 + 4 + kodlananBuf.length + 4;
  const yolHashOfset = birincilOfset + birincilBoyu;
  const tamOfset = yolHashOfset + yolHashBuf.length;
  const birincil = Buffer.concat([
    fstrAscii(baglama), i32(dosyalar.length), u64(tohum),
    u32(1), u64(yolHashOfset), u64(yolHashBuf.length), sha1(yolHashBuf),
    u32(1), u64(tamOfset), u64(tamDizinBuf.length), sha1(tamDizinBuf),
    i32(kodlananBuf.length), kodlananBuf, i32(0),
  ]);
  if (birincil.length !== birincilBoyu) throw new Error(`pak yazıcı: iç hata, birincil indeks boyu ${birincil.length} ≠ ${birincilBoyu}`);
  // 5) künye (221 bayt): GUID (16) | şifreli indeks (1) | sihir | sürüm | indeks ofseti | indeks boyu | SHA1 | 5 x 32 sıkıştırma adı
  const kunye = Buffer.alloc(KUNYE);
  kunye.writeUInt32LE(SIHIR, 17); kunye.writeUInt32LE(11, 21);
  kunye.writeBigUInt64LE(BigInt(birincilOfset), 25); kunye.writeBigUInt64LE(BigInt(birincil.length), 33);
  sha1(birincil).copy(kunye, 41);
  return Buffer.concat([veriBolumu, birincil, yolHashBuf, tamDizinBuf, kunye]);
}
