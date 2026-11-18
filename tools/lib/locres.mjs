// UE4 .locres (yerelleştirme) çözücü (`locresCoz`) ve yazıcı (`locresYaz`).
// Çözücü sürüm 0-3 biçimini bilir; yazıcı yalnızca 2 ve 3'ü (oyunun kullandığı 3) yazar. Oyun dosyasına yazmaz:
// yazıcı yalnızca bellekte bir Buffer döndürür, diske yazmak çağıranın işi.
const SIHIR = Buffer.from('0E14747567' + '4A03FC4A15909DC3377F1B', 'hex');
export const SURUM_ADLARI = ['Legacy', 'Compact', 'Optimized_CRC32', 'Optimized_CityHash64_UTF16'];

/**
 * @returns {{surum:number, bildirilenGiris:number|null, girisler:{ns:string,key:string,kaynakHash:number,deger:string,nsHash:number|null,keyHash:number|null}[],
 *            gecersizIndeks:number, dizi:number|null, tutarli:boolean}}
 * `tutarli`: giriş sayısı künyedekiyle tuttu ve hiçbir indeks dizi dışına taşmadı.
 * `nsHash` / `keyHash`: dosyadaki ad alanı ve anahtar karması (sürüm 2+; öncesinde null). Yazıcı bunları aynen geri yazar.
 */
export function locresCoz(b) {
  if (b.length < 17 || !b.subarray(0, 16).equals(SIHIR)) throw new Error('locres sihirli GUID yok (eski v0 biçimi ya da locres değil)');
  let p = 16;
  const u8 = () => b[p++];
  const i32 = () => { const v = b.readInt32LE(p); p += 4; return v; };
  const u32 = () => { const v = b.readUInt32LE(p); p += 4; return v; };
  const i64 = () => { const v = Number(b.readBigInt64LE(p)); p += 8; return v; };
  const fstr = () => {
    const n = i32();
    if (n === 0) return '';
    if (n > 0) { const s = b.toString('utf8', p, p + n - 1); p += n; return s; }
    const m = -n; const s = b.toString('utf16le', p, p + (m - 1) * 2); p += m * 2; return s;
  };

  const surum = u8();
  if (surum > 3) throw new Error(`bilinmeyen locres sürümü: ${surum}`);
  let dizi = null;
  if (surum >= 1) {
    const diziOfset = i64();
    if (diziOfset >= 0) {
      const sakla = p; p = diziOfset;
      const n = u32(); dizi = [];
      for (let i = 0; i < n; i++) { const s = fstr(); if (surum >= 2) i32(); dizi.push(s); }
      p = sakla;
    }
  }
  const bildirilenGiris = surum >= 2 ? u32() : null;
  const nsSayisi = u32();
  const girisler = [];
  let gecersizIndeks = 0;
  for (let n = 0; n < nsSayisi; n++) {
    const nsHash = surum >= 2 ? u32() : null;
    const ns = fstr();
    const kSayisi = u32();
    for (let k = 0; k < kSayisi; k++) {
      const keyHash = surum >= 2 ? u32() : null;
      const key = fstr();
      const kaynakHash = u32();
      let deger;
      if (surum >= 1) {
        const i = i32();
        if (dizi && i >= 0 && i < dizi.length) deger = dizi[i]; else { gecersizIndeks++; deger = ''; }
      } else deger = fstr();
      girisler.push({ ns, key, kaynakHash, deger, nsHash, keyHash });
    }
  }
  const tutarli = gecersizIndeks === 0 && (bildirilenGiris === null || bildirilenGiris === girisler.length);
  return { surum, bildirilenGiris, girisler, gecersizIndeks, dizi: dizi ? dizi.length : null, tutarli };
}

const i32Buf = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const u32Buf = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };

/**
 * UE FString yazışı: tamamı ASCII (≤ 0x7F) → pozitif uzunluk + bayt; değilse negatif uzunluk + UTF-16LE (uzunluk sonlandırıcı dahil).
 * Boş metin: `bosBirYaz` açıksa uzunluk 1 + tek sonlandırıcı bayt, değilse uzunluk 0. Oyunun kendi dosyalarında boş AD ALANI
 * uzunluk 1 olarak yazılı (12.11.2026 ölçüldü); okuyucu ikisini de '' okuduğu için bu fark okurken görünmez.
 */
function fstrYaz(s, bosBirYaz = false) {
  if (s === '') return bosBirYaz ? Buffer.concat([i32Buf(1), Buffer.alloc(1)]) : i32Buf(0);
  if (/^[\x00-\x7f]*$/.test(s)) return Buffer.concat([i32Buf(s.length + 1), Buffer.from(s, 'latin1'), Buffer.alloc(1)]);
  return Buffer.concat([i32Buf(-(s.length + 1)), Buffer.from(s, 'utf16le'), Buffer.alloc(2)]);
}

/**
 * locres yazar (sürüm 2 ya da 3). Girdi `locresCoz().girisler` biçiminde: { ns, key, kaynakHash, deger, nsHash, keyHash }.
 * Karmalar ÜRETİLMEZ, girişten aynen yazılır (algoritma bilinmiyor; çeviri dosyası İngilizce dosyanın girişlerinden kurulur).
 * Girişlerin sırası korunur; aynı ad alanı art arda gelirse tek grupta yazılır. Metin dizisi ilk kullanım sırasına göre tekilleştirilir.
 * @returns {Buffer}
 */
export function locresYaz({ surum = 3, girisler }) {
  if (surum !== 2 && surum !== 3) throw new Error(`locres yazıcı yalnız sürüm 2 ve 3 yazar (istenen: ${surum})`);
  const gruplar = [];
  for (const g of girisler) {
    for (const [ad, v] of [['nsHash', g.nsHash], ['keyHash', g.keyHash], ['kaynakHash', g.kaynakHash]]) {
      if (!Number.isInteger(v) || v < 0 || v > 0xFFFFFFFF) throw new Error(`locres yazıcı: ${g.ns}/${g.key} girişinde ${ad} geçerli bir u32 değil (${v})`);
    }
    if (typeof g.deger !== 'string') throw new Error(`locres yazıcı: ${g.ns}/${g.key} girişinin değeri metin değil`);
    const son = gruplar[gruplar.length - 1];
    if (son && son.ns === g.ns) {
      if (son.nsHash !== g.nsHash) throw new Error(`locres yazıcı: "${g.ns}" ad alanında farklı karmalar var`);
      son.girisler.push(g);
    } else gruplar.push({ ns: g.ns, nsHash: g.nsHash, girisler: [g] });
  }
  const dizi = [], no = new Map(), sayac = [];
  const indisle = (s) => {
    let i = no.get(s);
    if (i === undefined) { i = dizi.length; no.set(s, i); dizi.push(s); sayac.push(0); }
    sayac[i]++;
    return i;
  };
  const govde = [u32Buf(girisler.length), u32Buf(gruplar.length)];
  for (const gr of gruplar) {
    govde.push(u32Buf(gr.nsHash), fstrYaz(gr.ns, true), u32Buf(gr.girisler.length));
    for (const g of gr.girisler) govde.push(u32Buf(g.keyHash), fstrYaz(g.key), u32Buf(g.kaynakHash), i32Buf(indisle(g.deger)));
  }
  const govdeBuf = Buffer.concat(govde);
  const baslikBoyu = 16 + 1 + 8;
  const diziOfset = Buffer.alloc(8); diziOfset.writeBigInt64LE(BigInt(baslikBoyu + govdeBuf.length));
  const diziBuf = [u32Buf(dizi.length)];
  dizi.forEach((s, i) => diziBuf.push(fstrYaz(s), i32Buf(sayac[i])));
  return Buffer.concat([SIHIR, Buffer.from([surum]), diziOfset, govdeBuf, ...diziBuf]);
}
