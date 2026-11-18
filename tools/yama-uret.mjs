// Yama üretici ve kalıcı test kapısı. Türkçe `Game.locres`i ve dil listesi varlığını ("Türkçe" etiketi) kurar, 3 dosyalı `_P.pak` olarak `yama/` altına yazar.
// OYUNA YAZMAZ: oyun klasörü yalnızca okunur (oyunun paklarından `_P.pak` ile bitenler atlanır, yoksa kendi yamamızı İngilizce sanır).
//
// Kullanım:
//   node tools/yama-uret.mjs [--oyun <klasör>] [--cikti <klasör, varsayılan yama/>] [--kaynak <ceviri-kaynak çıktısı, varsayılan ceviri/kaynak>]    üret + diskten geri okuyup doğrula
//   node tools/yama-uret.mjs --sina                                                    kapı: locres yazıcı, pak yazıcı, üretici (gerçek oyun + sentetik)
// Girdiler: ceviri/parca-NN.json (kimlik → Türkçe) · ceviri/kaynak/indeks.json ve parca-NN.json (`node tools/ceviri-kaynak.mjs` üretir, git DIŞI).
// Çıkış: 0 tamam · 1 ölçüm/kapı başarısız · 2 girdi eksik ya da kullanım hatası
//
// Bu araç şunu GÖREMEZ: motorun bu pakı yükleyip Türkçe locres'i kullandığını (oyunda hiç denenmedi) · `_P.pak` adının yama önceliği
// verdiğini · yol karmasının motorun yama pakında (başka tohum) arayışını · UTF-16 yazışının Türkçeye özgü harflerde (ş ğ ı İ) gerçek
// bir oyun dosyasıyla tutup tutmadığını (yalnız sentetik) · çevirinin kalitesini · girdi ölçümünün başka build için geçerli olduğunu.
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import { budanmisKume, oyunPakAdlari, pakAc, pakYaz, yolKarmasi } from './lib/pak.mjs';
import { locresCoz, locresYaz } from './lib/locres.mjs';
import { baslikYazisi, dilVarligiEkDosyalari, trLocresBayt, trLocresKur, yamaPakKur, yaziTipiEkDosyasi, YAMA_DIL, YAMA_DIL_UASSET_YOLU, YAMA_DIL_UEXP_YOLU, YAMA_LOCRES_YOLU, YAMA_PAK_ADI, YAMA_YAZI_TIPI_YOLU } from './lib/yama.mjs';
import { cmapOku, iNoktaliYap } from './lib/yazi-tipi-yama.mjs';
import { cffAc, glifYolu, konturlar, sinirKutusu } from './lib/cff.mjs';
import { dilSatirlari, dilSatiriEkle } from './lib/dil-varligi.mjs';

const KOK = fileURLToPath(new URL('..', import.meta.url));
const VARSAYILAN = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\The Forgotten City';
const arg = process.argv.slice(2);
const deger = (ad, yedek) => { const i = arg.indexOf(ad); return i >= 0 ? arg[i + 1] : yedek; };
const OYUN = deger('--oyun', process.env.FC_OYUN || VARSAYILAN);
const CIKTI = deger('--cikti', join(KOK, 'yama'));
const KAYNAK = deger('--kaynak', join(KOK, 'ceviri', 'kaynak'));   // ceviri-kaynak çıktısı (yükleyici geçici klasör verir)
const PAKLAR = join(OYUN, 'ModernStoryteller01', 'Content', 'Paks');
const sha1 = (b) => createHash('sha1').update(b).digest();

function girdiYok(ne, nasil = '"node tools/ceviri-kaynak.mjs" ile üret (çeviri parçaları ceviri/ altında git\'te olmalı)') {
  console.error(`Girdi yok: ${ne}\n${nasil}`);
  process.exit(2);
}

/** Oyunun paketleri; `_P.pak` ile bitenler (yama paketleri, bizimki dahil) atlanır. */
function oyunPaketleri() {
  if (!existsSync(PAKLAR)) { console.error(`Oyun klasörü bulunamadı: ${OYUN}\n(--oyun <klasör> ya da FC_OYUN ile ver)`); process.exit(2); }
  return oyunPakAdlari(readdirSync(PAKLAR)).map(a => pakAc(join(PAKLAR, a)));
}

function parcaDosyalari(klasor) {
  if (!existsSync(klasor)) girdiYok(klasor);
  const d = readdirSync(klasor).filter(a => /^parca-\d+\.json$/.test(a)).sort();
  if (!d.length) girdiYok(`${klasor} altında parca-NN.json`);
  return d.map(a => join(klasor, a));
}

/**
 * Çeviri girdileri: { indeks, ceviri (kimlik → Türkçe), kaynakEn (kimlik → İngilizce), baslik ([ad alanı, anahtar] çiftleri) }.
 * `baslik`: `ceviri/baslik-yazi-tipi.json` (başlık yazı tipiyle çizilen anahtarlar); dosya yoksa ya da bozuksa SESSİZ GEÇİLMEZ
 * (yoksa pak başlıkta noktasız i ile sessizce üretilirdi).
 * Liste kontrolleri (dosya yok · `anahtarlar` boş · anahtarın ns/key alanı metin değil) `--sina`da SINANMIYOR: yol `KOK`e sabit,
 * fonksiyon üretici dışında çağrılamıyor. Yalnız "alanı metin değil" kontrolü gerçek bir koşumda tetiklendi (13.11.2026, yanlış
 * biçimli liste reddedildi); öteki ikisi hiç tetiklenmedi.
 */
function ceviriGirdisi() {
  const indeksYolu = join(KAYNAK, 'indeks.json');
  if (!existsSync(indeksYolu)) girdiYok(indeksYolu);
  const baslikYolu = join(KOK, 'ceviri', 'baslik-yazi-tipi.json');
  if (!existsSync(baslikYolu)) girdiYok(baslikYolu, '"node tools/taslak/goudy-export.mjs --json ceviri/baslik-yazi-tipi.json" ile üret (başlık yazı tipi anahtar listesi, git\'te olmalı)');
  const baslikJson = JSON.parse(readFileSync(baslikYolu, 'utf8'));
  if (!Array.isArray(baslikJson.anahtarlar) || !baslikJson.anahtarlar.length) throw new Error(`${baslikYolu}: "anahtarlar" dolu bir dizi olmalı`);
  const baslik = baslikJson.anahtarlar.map((a, i) => {
    if (typeof a?.ns !== 'string' || typeof a?.key !== 'string') throw new Error(`${baslikYolu}: ${i}. anahtarın ns ve key alanı metin olmalı`);
    return [a.ns, a.key];
  });
  const indeks = JSON.parse(readFileSync(indeksYolu, 'utf8'));
  const ceviri = {};
  for (const d of parcaDosyalari(join(KOK, 'ceviri'))) {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(d, 'utf8')))) {
      if (Object.prototype.hasOwnProperty.call(ceviri, k)) throw new Error(`${d}: kimlik ${k} birden çok parçada`);
      ceviri[k] = v;
    }
  }
  const kaynakEn = {};
  for (const d of parcaDosyalari(KAYNAK)) {
    for (const g of JSON.parse(readFileSync(d, 'utf8')).gruplar) for (const m of g.metinler) kaynakEn[String(m.id)] = m.en;
  }
  return { indeks, ceviri, kaynakEn, baslik };
}

/** Oyunun paketlerinden bütün `Localization/Game/<dil>/Game.locres` dosyaları: [{ dil, bayt }]. */
function oyunLocresleri(paketler) {
  const sonuc = [];
  for (const pk of paketler) for (const g of pk.liste()) {
    const m = /Localization\/Game\/([^/]+)\/Game\.locres$/.exec(g.yol);
    if (m) sonuc.push({ dil: m[1], bayt: pk.icerik(g) });
  }
  return sonuc;
}

/**
 * Oyunun paketlerinden dil listesi varlığı (özgün `.uasset` ve `.uexp`). Bulunamazsa HATA: sessiz geçilirse pak "Türkçe" etiketsiz
 * üretilirdi (oyun build'i değişip yol kaymış olabilir).
 */
function oyunDilVarligi(paketler) {
  let uasset = null, uexp = null;
  for (const pk of paketler) for (const g of pk.liste()) {
    if (g.yol === YAMA_DIL_UASSET_YOLU) uasset = pk.icerik(g);
    else if (g.yol === YAMA_DIL_UEXP_YOLU) uexp = pk.icerik(g);
  }
  if (!uasset || !uexp) throw new Error(`oyunda dil listesi varlığı bulunamadı (${YAMA_DIL_UASSET_YOLU} ya da .uexp): oyun build'i değişmiş olabilir`);
  return { uasset, uexp };
}

/** Oyunun paketlerinden başlık yazı tipinin özgün baytları. Bulunamazsa HATA (build değişmiş olabilir). */
function oyunYaziTipi(paketler) {
  for (const pk of paketler) for (const g of pk.liste()) if (g.yol === YAMA_YAZI_TIPI_YOLU) return pk.icerik(g);
  throw new Error(`oyunda başlık yazı tipi bulunamadı (${YAMA_YAZI_TIPI_YOLU}): oyun build'i değişmiş olabilir`);
}

function okuAralik(yol, ofset, uzunluk) {
  const fd = openSync(yol, 'r');
  try { const b = Buffer.alloc(uzunluk); readSync(fd, b, 0, uzunluk, ofset); return b; } finally { closeSync(fd); }
}

/**
 * Başlık anahtarında değer, çeviriden YALNIZ "yer tutucu dışındaki her `i` → `İ`" kadar farklı olmalı. `baslikYazisi`ni ÇAĞIRMAZ
 * (üreten kodun kendi kuralıyla kendini onaylamasın): üç ayrı kural. Yer tutucu deseni de kasten burada ayrıca yazılı (kural
 * sabitini import etmek, sabit bozulunca kapıyı da bozardı).
 * @returns {string|null} sorun (null = tamam)
 */
export function baslikDegerSorunu(deger, ceviriMetni) {
  const YER_TUTUCU = /\{[^{}]*\}|<[^<>]*>/g;
  if (deger.length !== ceviriMetni.length) return 'uzunluk farklı';
  for (let k = 0; k < ceviriMetni.length; k++) {
    if (deger[k] !== ceviriMetni[k] && !(ceviriMetni[k] === 'i' && deger[k] === 'İ')) return `${k}. karakter i → İ dışında değişmiş`;
  }
  const yt = (s) => JSON.stringify(s.match(YER_TUTUCU) ?? []);
  if (yt(deger) !== yt(ceviriMetni)) return 'yer tutucu ya da etiket değişmiş';
  if (/i/.test(deger.replace(YER_TUTUCU, ''))) return 'yer tutucu dışında noktalı i kalmış';
  return null;
}

/**
 * Çıkış kapısı: yazılmış pak DİSKTEN okunur. Tek dosya mı, yol doğru mu, içerik beklenen locres baytı mı, locres tutarlı mı,
 * her girişin ad alanı/anahtar/üç karma İngilizce'yle aynı mı, her değer Türkçe[kimlik] mi (kimlik 0 → boş).
 * `baslik` ([ad alanı, anahtar] çiftleri; başlık kuralı yoksa AÇIKÇA `[]`): bu anahtarlarda değer yerine `baslikDegerSorunu` kuralı
 * aranır, listedeki her anahtar locres'te bulunmalı. Verilmezse hata fırlar (unutulan parametre kuralı sessizce kapatmasın).
 * `dilVarligi` ({ ozgunUasset, ozgunUexp, uasset, uexp }, dördü de Buffer; `null` = pak tek dosyalı, eski davranış): verilirse pakta
 * TAM 3 dosya (locres + dil listesi varlığının uasset ve uexp'i) olmalı, yollar tam, uasset/uexp baytları `uasset`/`uexp` ile eşit
 * VE diskten okunan baytlar `dilSatirlari` ile ayrıştırılınca satırlar = özgün satırlar + `YAMA_DIL` olmalı (yeni satırın biçimi
 * bu kapıda ayrıca yazılı: kuran kodun kendi çıktısıyla kendini onaylamasın). Pakın dosyaları klasör sırasıyla gelir (girdi
 * sırasıyla değil): bu yüzden dosyalar yola göre eşlenir.
 * @returns {string[]} sorun metinleri (boşsa tamam)
 */
// Yamalı yazı tipini ÖZGÜNLE karşılaştırır (kitaplığın yazma koduna bakmaz; yalnız CFF okuyucusunu kullanır): i (U+0069) yeni bir glife
// bağlı, başka kod noktası değişmemiş, başka hiçbir glifin charstring'i değişmemiş, yeni glif = özgün i gövdesi + özgün İ'nin noktası
// (aynı boy, gövdeye yatayda ortalı, gövdenin tepesinden özgün İ'deki aralık kadar yukarıda). Sorun iletileri dizisi verir.
export function yaziTipiSorunlari(ozgun, yama) {
  const sorun = [];
  const o = cmapOku(ozgun), y = cmapOku(yama);
  const gYeni = y.glif(0x69), gI = o.glif(0x69), gIN = o.glif(0x130);
  if (gYeni === gI || gYeni === gIN || gYeni === 0) { sorun.push('paktaki yazı tipinde i (U+0069) kısa boy İ glifine bağlı değil'); return sorun; }
  let degisen = 0; for (let k = 0; k <= 0xFFFF; k++) if (k !== 0x69 && o.glif(k) !== y.glif(k)) degisen++;
  if (degisen) sorun.push(`paktaki yazı tipinde i dışında ${degisen} kod noktasının glifi değişmiş`);
  const cffAl = (b) => { for (let t = 0; t < b.readUInt16BE(4); t++) { const p = 12 + t * 16; if (b.toString('latin1', p, p + 4) === 'CFF ') return b.subarray(b.readUInt32BE(p + 8), b.readUInt32BE(p + 8) + b.readUInt32BE(p + 12)); } throw new Error('CFF tablosu yok'); };
  try {
    const co = cffAc(cffAl(ozgun)), cy = cffAc(cffAl(yama));
    if (co.gidSayisi !== cy.gidSayisi) { sorun.push('paktaki yazı tipinde glif sayısı değişmiş'); return sorun; }
    let fark = 0; for (let g = 0; g < co.gidSayisi; g++) if (g !== gYeni && !co.cs.oge[g].equals(cy.cs.oge[g])) fark++;
    if (fark) sorun.push(`paktaki yazı tipinde yeni glif dışında ${fark} glifin charstring'i değişmiş`);
    const gov = glifYolu(co, gI), uz = konturlar(glifYolu(co, gIN).yol), yn = konturlar(glifYolu(cy, gYeni).yol);
    const ku = uz.map(sinirKutusu), nI = ku[0].y1 > ku[1].y1 ? 0 : 1, govU = ku[1 - nI], nokU = ku[nI];
    const govK = sinirKutusu(gov.yol), kn = yn.map(sinirKutusu);
    if (uz.length !== 2 || yn.length !== 2) { sorun.push(`yeni glif ${yn.length} konturlu (gövde + nokta = 2 bekleniyordu)`); return sorun; }
    const g0 = JSON.stringify(konturlar(gov.yol)[0].map(s => Object.values(s).map(Math.round))), g1 = JSON.stringify(yn[0].map(s => Object.values(s).map(Math.round)));
    if (g0 !== g1) sorun.push('yeni glifin gövdesi özgün i glifinin gövdesiyle aynı değil');
    const nk = kn[1];
    if (nk.x1 - nk.x0 !== nokU.x1 - nokU.x0 || nk.y1 - nk.y0 !== nokU.y1 - nokU.y0) sorun.push('yeni glifin noktasının boyu özgün İ noktasıyla aynı değil');
    if (Math.abs((nk.x0 + nk.x1) / 2 - (govK.x0 + govK.x1) / 2) > 1) sorun.push('yeni glifin noktası gövdeye yatayda ortalı değil');
    if (nk.y0 - govK.y1 !== nokU.y0 - govU.y1) sorun.push('yeni glifte nokta ile gövde arasındaki düşey aralık özgün İ ile aynı değil');
  } catch (e) { sorun.push(`yazı tipi glif denetimi yapılamadı: ${e.message}`); }
  return sorun;
}

export function kapiSorunlari(pakYolu, beklenenLocres, en, eslesme, ceviri, baslik, dilVarligi = null, yaziTipi = null) {
  if (!Array.isArray(baslik)) throw new Error('kapiSorunlari: başlık listesi verilmeli (başlık kuralı yoksa boş dizi)');
  if (dilVarligi !== null && !['ozgunUasset', 'ozgunUexp', 'uasset', 'uexp'].every(k => Buffer.isBuffer(dilVarligi?.[k]))) {
    throw new Error('kapiSorunlari: dilVarligi { ozgunUasset, ozgunUexp, uasset, uexp } olmalı (dördü de Buffer) ya da null');
  }
  const baslikKume = new Set(baslik.map(([ns, key]) => `${ns}\u0000${key}`));
  const sorun = [];
  if (yaziTipi !== null && !['ozgun', 'yama'].every(k => Buffer.isBuffer(yaziTipi?.[k]))) {
    throw new Error('kapiSorunlari: yaziTipi { ozgun, yama } olmalı (ikisi de Buffer) ya da null');
  }
  const beklenenYollar = [YAMA_LOCRES_YOLU, ...(dilVarligi ? [YAMA_DIL_UASSET_YOLU, YAMA_DIL_UEXP_YOLU] : []), ...(yaziTipi ? [YAMA_YAZI_TIPI_YOLU] : [])];
  const pk = pakAc(pakYolu);
  try {
    const l = pk.liste();
    const yolaGore = new Map(l.map(g => [g.yol, g]));
    const eksikYol = beklenenYollar.find(y => !yolaGore.has(y));
    if (l.length !== beklenenYollar.length) sorun.push(`pakta ${l.length} dosya var, ${beklenenYollar.length} bekleniyordu`);
    else if (eksikYol !== undefined) sorun.push(`pakın yolu beklenenle uyuşmuyor: "${eksikYol}" yok (pakta: ${l.map(g => `"${g.yol}"`).join(', ')})`);
    else {
      const bayt = pk.icerik(yolaGore.get(YAMA_LOCRES_YOLU));
      if (!bayt.equals(beklenenLocres)) sorun.push('paktaki locres baytları kurulan locres ile aynı değil');
      const tr = locresCoz(bayt);
      if (!tr.tutarli) sorun.push('paktaki locres tutarsız (giriş sayısı ya da dizi indeksi)');
      if (tr.girisler.length !== en.girisler.length) sorun.push(`giriş sayısı ${tr.girisler.length}, İngilizce ${en.girisler.length}`);
      else {
        let farkliKimlik = 0, farkliDeger = 0, baslikGorulen = 0, baslikFarkli = 0;
        tr.girisler.forEach((t, i) => {
          const e = en.girisler[i];
          if (t.ns !== e.ns || t.key !== e.key || t.kaynakHash !== e.kaynakHash || t.nsHash !== e.nsHash || t.keyHash !== e.keyHash) farkliKimlik++;
          const id = eslesme[i][3];
          const beklenen = id === 0 ? '' : ceviri[String(id)];
          if (baslikKume.has(`${e.ns}\u0000${e.key}`)) { baslikGorulen++; if (baslikDegerSorunu(t.deger, beklenen) !== null) baslikFarkli++; }
          else if (t.deger !== beklenen) farkliDeger++;
        });
        if (farkliKimlik) sorun.push(`${farkliKimlik} girişte ad alanı/anahtar/karma İngilizce ile farklı`);
        if (farkliDeger) sorun.push(`${farkliDeger} girişte değer Türkçe[kimlik] ile farklı`);
        if (baslikFarkli) sorun.push(`${baslikFarkli} başlık girişinde değer Türkçe[kimlik]'ten yalnız "yer tutucu dışında i → İ" kadar farklı olmalıydı`);
        if (baslikGorulen !== baslikKume.size) sorun.push(`başlık listesindeki ${baslikKume.size - baslikGorulen} anahtar locres'te yok`);
      }
      if (yaziTipi) {
        const yt = pk.icerik(yolaGore.get(YAMA_YAZI_TIPI_YOLU));
        if (!yt.equals(yaziTipi.yama)) sorun.push('paktaki yazı tipi baytları kurulan ile aynı değil');
        // beklenti kasten burada ayrıca yazılı (yaziTipiSorunlari): i yeni kısa boy İ glifine bağlı; öteki kod noktaları ve glifler özgünle aynı
        try { sorun.push(...yaziTipiSorunlari(yaziTipi.ozgun, yt)); } catch (e) { sorun.push(`paktaki yazı tipi okunamadı: ${e.message}`); }
      }
      if (dilVarligi) {
        const ua = pk.icerik(yolaGore.get(YAMA_DIL_UASSET_YOLU)), ue = pk.icerik(yolaGore.get(YAMA_DIL_UEXP_YOLU));
        if (!ua.equals(dilVarligi.uasset)) sorun.push('paktaki LanguageTagToNames.uasset baytları kurulan ile aynı değil');
        if (!ue.equals(dilVarligi.uexp)) sorun.push('paktaki LanguageTagToNames.uexp baytları kurulan ile aynı değil');
        let gelen = null, ozgun = null;
        try { gelen = dilSatirlari(ua, ue); } catch (e) { sorun.push(`paktaki dil varlığı okunamadı: ${e.message}`); }
        try { ozgun = dilSatirlari(dilVarligi.ozgunUasset, dilVarligi.ozgunUexp); } catch (e) { sorun.push(`özgün dil varlığı okunamadı: ${e.message}`); }
        if (gelen && ozgun) {
          // yeni satırın biçimi (değişmez metin, bayrak 2) kasten burada ayrıca yazılı; `yama.mjs`ten alınmaz
          const beklenen = [...ozgun, { etiket: YAMA_DIL.etiket, ad: { tur: 'degismez', metin: YAMA_DIL.ad, bayrak: 2 } }];
          let esit = true; try { deepStrictEqual(gelen, beklenen); } catch { esit = false; }
          if (!esit) sorun.push(`paktaki dil listesi "özgün ${ozgun.length} satır + ${YAMA_DIL.etiket}" değil (pakta ${gelen.length} satır: ${gelen.map(s => s.etiket).join(' ')})`);
        }
      }
    }
  } finally { pk.kapat(); }
  return sorun;
}

/**
 * Gerçek girdilerle (çeviri + başlık listesi) Türkçe locres ve pakı kurar, `klasor` altına yazar, çıkış kapısını DİSKTEN okunan pakla
 * koşar. `uret()` ve `sina()` AYNI işlevi kullanır: başlık listesinin üreticiye ve kapıya bağlanması sınamada da koşar.
 */
function uretVeDogrula(en, klasor, dilOzgun = null, yaziOzgun = null) {
  const { indeks, ceviri, kaynakEn, baslik } = ceviriGirdisi();
  const tr = trLocresKur({ en, eslesme: indeks.eslesme, ceviri, kaynakEn, baslik });
  const locres = trLocresBayt(tr.girisler);
  // dilOzgun ({ uasset, uexp }, oyunun özgün dil listesi varlığı) verilirse pak 3 dosyalı ("Türkçe" etiketi), verilmezse tek dosyalı
  const ek = dilOzgun ? dilVarligiEkDosyalari(dilOzgun.uasset, dilOzgun.uexp) : [];
  const yt = yaziOzgun ? yaziTipiEkDosyasi(yaziOzgun) : [];
  const pak = yamaPakKur(locres, [...ek, ...yt]);
  mkdirSync(klasor, { recursive: true });
  const yol = join(klasor, YAMA_PAK_ADI);
  writeFileSync(yol, pak);
  const dilVarligi = dilOzgun ? { ozgunUasset: dilOzgun.uasset, ozgunUexp: dilOzgun.uexp, uasset: ek[0].veri, uexp: ek[1].veri } : null;
  const sorun = kapiSorunlari(yol, locres, en, indeks.eslesme, ceviri, baslik, dilVarligi, yaziOzgun ? { ozgun: yaziOzgun, yama: yt[0].veri } : null);
  return { indeks, ceviri, kaynakEn, baslik, tr, locres, pak, yol, sorun };
}

function uret() {
  const paketler = oyunPaketleri();
  const enL = oyunLocresleri(paketler).find(x => x.dil === 'en');
  let dilOzgun = null, yaziOzgun = null, dilHatasi = null;
  try { dilOzgun = oyunDilVarligi(paketler); yaziOzgun = oyunYaziTipi(paketler); } catch (e) { dilHatasi = e; }   // paketler kapanmadan oku; hatayı kapattıktan sonra fırlat
  paketler.forEach(p => p.kapat());
  if (!enL) throw new Error('oyunda en/Game.locres bulunamadı');
  if (dilHatasi) throw dilHatasi;
  const en = locresCoz(enL.bayt);
  if (!en.tutarli) throw new Error('İngilizce locres okuması tutarsız');
  const { indeks, tr, locres, pak, yol, sorun } = uretVeDogrula(en, CIKTI, dilOzgun, yaziOzgun);
  console.log(`giriş ${tr.sayilar.toplam} · çevrilen benzersiz metin ${tr.sayilar.cevrilen} · boş ${tr.sayilar.bos} · indeks build ${indeks.build}`);
  console.log(`başlık yazı tipi: ${tr.sayilar.baslik} anahtar, ${tr.sayilar.baslikDegisen} girişte i → İ yazıldı`);
  const dilSatirSayisi = dilSatirlari(dilOzgun.uasset, dilOzgun.uexp).length;
  console.log(`dil listesi: "${YAMA_DIL.ad}" (${YAMA_DIL.etiket}) satırı eklendi (${dilSatirSayisi} → ${dilSatirSayisi + 1} satır; pak 3 dosyalı)`);
  console.log(`başlık yazı tipi yaması: cmap'te i → kısa boy noktalı İ glifi (özgün ${yaziOzgun.length} bayt; pak 4 dosyalı)`);
  console.log(`yazıldı: ${yol} (${pak.length} bayt; locres ${locres.length} bayt)`);
  if (sorun.length) { console.error(`ÇIKIŞ KAPISI BAŞARISIZ: ${sorun.join(' · ')}`); process.exit(1); }
  console.log('çıkış kapısı: pak diskten okundu; yol, içerik, giriş sayısı, anahtar ve karmalar İngilizce ile aynı, her değer Türkçe[kimlik] (başlık anahtarlarında yalnız i → İ farkıyla); pakta TAM 4 dosya, yazı tipinde yalnız i → İ glifi, dil listesi uasset/uexp baytları kurulanla eşit ve satırlar = özgün + tr — tamam');
  console.log('bu araç şunu ölçmez: motorun bu pakı yükleyip yüklemediği · _P.pak adının öncelik verdiği · İ\'nin oyunda başlıkta nasıl göründüğü · Steam klasörüne KOYULMADI (izin gerekir)');
}

// Koşul `dene`ye hesaplanmış gelir: ifade hata fırlatırsa dene hiç çağrılmaz ve hata en üstteki catch'e kaçar. Hatanın hangi
// sınamada olduğu anonim kalmasın diye en son TAMAMLANAN sınamanın adı tutulur (çöken sınama onun hemen ardındakidir).
let sonSinama = null;

function sina() {
  let basarisiz = 0;
  const dene = (ad, kosul) => { sonSinama = ad; console.log(`${kosul ? 'TAMAM' : 'BAŞARISIZ'}  ${ad}`); if (!kosul) basarisiz++; };
  const firlatir = (f, desen) => { try { f(); return false; } catch (e) { return desen.test(e.message); } };
  const hataNull = (f) => { try { return f(); } catch { return null; } };   // okuyucu hata fırlatırsa sınama adıyla BAŞARISIZ görünsün, süreç çökmesin
  const g =(ns, key, kaynakHash, degerMetni, nsHash, keyHash) => ({ ns, key, kaynakHash, deger: degerMetni, nsHash, keyHash });
  const gecici = mkdtempSync(join(tmpdir(), 'fc-yama-sina-'));
  const acilanlar = [];

  try {
    // ---------------- A: locres yazıcı
    const sent = [
      g('', 'A1', 0, 'Hello', 0, 0), g('', 'A2', 0xFFFFFFFF, 'Türkçe: ışığın şiddeti, İĞŞÇÖÜ', 0, 0xFFFFFFFF), g('', 'A3', 5, '', 0, 7),
      g('UI', 'B1', 6, 'Hello', 111, 8), g('', 'A4', 9, 'Hello', 0, 10),
    ];
    const sb = locresYaz({ girisler: sent });
    const sc = locresCoz(sb);
    let esit = true; try { deepStrictEqual(sc.girisler, sent); } catch { esit = false; }
    dene('locres sentetik: yaz → oku derin eşit (ASCII, Türkçe harf, boş ad alanı, boş değer, ad alanı A,B,A, karma 0 ve 0xFFFFFFFF)', esit && sc.tutarli && sc.surum === 3);
    dene('locres sentetik: Türkçe değer UTF-16LE baytlarıyla dosyada (ş ğ ı İ dahil)', sb.includes(Buffer.from('ışığın şiddeti, İĞŞÇÖÜ', 'utf16le')));
    dene('locres sentetik: ASCII değer tek baytlık yazılıyor (UTF-16 değil)', sb.includes(Buffer.from('Hello', 'latin1')) && !sb.includes(Buffer.from('Hello', 'utf16le')));
    dene('locres sentetik: aynı metin iki girişte → metin dizisinde bir kez', locresCoz(locresYaz({ girisler: [g('', 'X', 1, 'Aynı', 1, 1), g('', 'Y', 2, 'Aynı', 1, 2)] })).dizi === 1);
    dene('locres sentetik: sürüm 2 de yazılıyor ve geri okunuyor', locresCoz(locresYaz({ surum: 2, girisler: sent })).surum === 2);
    for (const kotu of [-1, 2 ** 32, 1.5, null, undefined, '7']) {
      dene(`locres hata: geçersiz karma (${String(kotu)}) reddediliyor`, firlatir(() => locresYaz({ girisler: [g('', 'K', 1, 'x', 1, kotu)] }), /u32/));
    }
    dene('locres hata: sürüm 1 reddediliyor', firlatir(() => locresYaz({ surum: 1, girisler: sent }), /yalnız sürüm 2 ve 3/));
    dene('locres hata: aynı ad alanında (art arda) farklı nsHash reddediliyor', firlatir(() => locresYaz({ girisler: [g('N', 'a', 1, 'x', 1, 1), g('N', 'b', 2, 'y', 2, 2)] }), /farklı karmalar/));
    dene('locres hata: metin olmayan değer reddediliyor', firlatir(() => locresYaz({ girisler: [g('', 'a', 1, 5, 1, 1)] }), /metin değil/));

    const paketler = oyunPaketleri();
    acilanlar.push(...paketler);
    const locresler = oyunLocresleri(paketler);
    dene(`locres gerçek: en az 8 dilin Game.locres'i bulundu (${locresler.map(x => x.dil).join(' ')})`, locresler.length >= 8);
    for (const { dil, bayt } of locresler) {
      const o = locresCoz(bayt);
      const asciiDisi = o.girisler.filter(x => /[^\x00-\x7f]/.test(x.deger)).length;
      dene(`locres gerçek ${dil}: yaz(coz(x)) bayt bayt aynı (${o.girisler.length} giriş, ASCII dışı değer ${asciiDisi})`, locresYaz({ surum: o.surum, girisler: o.girisler }).equals(bayt));
    }
    for (const dil of ['de', 'es', 'fr']) {
      const x = locresler.find(l => l.dil === dil);
      dene(`locres gerçek ${dil}: aksanlı Latin harfli (ASCII dışı) değer var, yani UTF-16 yazışı gerçek dosyada sınanıyor`, !!x && locresCoz(x.bayt).girisler.some(e => /[^\x00-\x7f]/.test(e.deger)));
    }

    // ---------------- B: pak yazıcı
    const buyuk = Buffer.alloc(100 * 1024, 0); for (let i = 0; i < buyuk.length; i++) buyuk[i] = (i * 31 + 7) & 255;
    const sd = [
      { yol: 'a.txt', veri: Buffer.from('merhaba') }, { yol: 'Dir/Sub/b.bin', veri: Buffer.alloc(0) },
      { yol: 'Dir/c.bin', veri: buyuk }, { yol: 'Dir/Sub/Deep/c.txt', veri: Buffer.from('derin') },
    ];
    const sp = pakYaz({ dosyalar: sd, tohum: 123456789n });
    dene('pak sentetik: aynı girdi aynı baytları veriyor (belirleyici)', pakYaz({ dosyalar: sd, tohum: 123456789n }).equals(sp));
    const spYol = join(gecici, 'sent.pak'); writeFileSync(spYol, sp);
    const spk = pakAc(spYol); acilanlar.push(spk);
    const sl = spk.liste();
    // `liste()` dosyaları tam dizinin KLASÖR sırasıyla verir (kök, Dir/, Dir/Sub/ ...), yazıcının girdi sırasıyla değil: eşleme yola göre.
    // Girdi sırası kodlanmış giriş tablosunda ve veri bölümünde durur: i. girdinin kodOfset'i i*12, ofsetleri artan.
    const girdiNo = (x) => sd.findIndex(s => s.yol === x.yol);
    const girdiSirasi = [...sl].sort((a, b) => girdiNo(a) - girdiNo(b));
    dene('pak sentetik: girdi yolları, giriş sayısı ve sürüm geri okununca aynı (liste() dizin sırasıyla, girdi sırasından farklı olabilir)',
      sl.length === sd.length && girdiSirasi.map(x => x.yol).join('|') === sd.map(x => x.yol).join('|') && spk.girisSayisi === sd.length && spk.surum === 11);
    dene('pak sentetik: karşı test, bu girdide liste() sırası girdi sırasından gerçekten farklı (yola göre eşleme gerekli)', sl.map(x => x.yol).join('|') !== sd.map(x => x.yol).join('|'));
    dene('pak sentetik: girdi sırası korunuyor (i. girdinin kodOfset\'i i*12, veri ofsetleri artan)', girdiSirasi.every((x, i) => x.kodOfset === i * 12 && (i === 0 || x.ofset > girdiSirasi[i - 1].ofset)));
    dene('pak sentetik: içerikler bayt bayt aynı (boş dosya ve 100 KB dahil)', sl.every(x => spk.icerik(x).equals(sd[girdiNo(x)].veri)));
    dene('pak sentetik: tohum geri okunuyor, bağlama noktası "../../../"', spk.tohum === 123456789n && spk.baglamaNoktasi === '../../../');
    const yk = spk.yolKarmalari();
    dene('pak sentetik: yol karmaları yolKarmasi(yol, tohum) ile aynı ve kodOfset dosyayla eşleşiyor',
      yk.length === sd.length && yk.every((k, i) => k.karma === yolKarmasi(sd[i].yol, 123456789n) && k.kodOfset === girdiSirasi[i].kodOfset));
    const sk = spk.klasorler().map(k => k.dizin).sort().join('|');
    dene('pak sentetik: klasör satırları = kök + bütün üst klasörler (dosyasız ara klasör "Dir/Sub/" dahil)', sk === ['', 'Dir/', 'Dir/Sub/', 'Dir/Sub/Deep/'].join('|'));
    dene('pak sentetik: SHA1\'ler (dosya başlığı, birincil indeks, yol karması, tam dizin) içerikle tutuyor',
      sl.every(x => okuAralik(spYol, x.ofset + 28, 20).equals(sha1(sd[girdiNo(x)].veri))) &&
      sha1(okuAralik(spYol, spk.indeksOfset, spk.indeksBoyut)).equals(spk.indeksSha1) &&
      sha1(okuAralik(spYol, spk.yolHashOfset, spk.yolHashBoyut)).equals(spk.yolHashSha1) &&
      sha1(okuAralik(spYol, spk.tamOfset, spk.tamBoyut)).equals(spk.tamSha1));
    for (const kotu of ['/a.txt', 'a/', 'a//b', 'türkçe.txt', '']) {
      dene(`pak hata: geçersiz yol "${kotu}" reddediliyor`, firlatir(() => pakYaz({ dosyalar: [{ yol: kotu, veri: Buffer.alloc(0) }] }), /geçersiz yol/));
    }
    dene('pak hata: büyük/küçük harf farkıyla aynı yol iki kez reddediliyor', firlatir(() => pakYaz({ dosyalar: [{ yol: 'A/b', veri: Buffer.alloc(0) }, { yol: 'a/B', veri: Buffer.alloc(0) }] }), /iki kez/));
    dene('pak hata: Buffer olmayan veri reddediliyor', firlatir(() => pakYaz({ dosyalar: [{ yol: 'a', veri: 'metin' }] }), /Buffer değil/));

    for (const pk of paketler) {
      const lst = pk.liste(); const ad = pk.yol.split(/[\\/]/).pop();
      const harita = new Map(pk.yolKarmalari().map(k => [k.karma, k.kodOfset]));
      dene(`pak gerçek ${ad}: ${lst.length} dosyanın hepsinde yol karması ve kodOfset tutuyor`, harita.size === lst.length && lst.every(x => harita.get(yolKarmasi(x.yol, pk.tohum)) === x.kodOfset));
      const klasorlu = lst.filter(x => x.yol.includes('/')).slice(0, 2000);
      dene(`pak gerçek ${ad}: karşı test, yalnız ad hash'lenince klasörlü dosyaların hiçbiri tutmuyor (${klasorlu.length} dosya)`, klasorlu.length === 0 || klasorlu.every(x => !harita.has(yolKarmasi(x.yol.split('/').pop(), pk.tohum))));
      const beklenen = new Map([['', 0]]);
      for (const x of lst) {
        const p = x.yol.split('/'); p.pop();
        for (let n = 1; n <= p.length; n++) { const d = p.slice(0, n).join('/') + '/'; if (!beklenen.has(d)) beklenen.set(d, 0); }
        const d = p.length ? p.join('/') + '/' : ''; beklenen.set(d, (beklenen.get(d) ?? 0) + 1);
      }
      const kl = pk.klasorler();
      dene(`pak gerçek ${ad}: klasör satırları = kök + bütün üst klasörler (${kl.length} satır) ve her klasörün dosya sayısı tutuyor`,
        kl.length === beklenen.size && kl.every(k => beklenen.get(k.dizin) === k.dosyaSayisi));
      dene(`pak gerçek ${ad}: birincil indeks, yol karması ve tam dizin SHA1'leri içerikle tutuyor`,
        sha1(okuAralik(pk.yol, pk.indeksOfset, pk.indeksBoyut)).equals(pk.indeksSha1) &&
        sha1(okuAralik(pk.yol, pk.yolHashOfset, pk.yolHashBoyut)).equals(pk.yolHashSha1) &&
        sha1(okuAralik(pk.yol, pk.tamOfset, pk.tamBoyut)).equals(pk.tamSha1));
      if (lst.length <= 100) dene(`pak gerçek ${ad}: ${lst.length} dosyanın başlık SHA1'i = sha1(içerik)`, lst.every(x => okuAralik(pk.yol, x.ofset + 28, 20).equals(sha1(pk.icerik(x)))));
    }

    // ---------------- C: üretici
    const enL = locresler.find(x => x.dil === 'en');
    const en = locresCoz(enL.bayt);
    // `uret()` ile AYNI işlev (başlık listesi üreticiye ve kapıya bağlanmış mı, burada da koşar); pak `gecici` altına yazılır
    const u = uretVeDogrula(en, gecici);
    const { indeks, ceviri, kaynakEn, baslik, tr, locres } = u;
    const baslikMi = (e) => baslik.some(([ns, key]) => ns === e.ns && key === e.key);
    const geri = locresCoz(locres);
    dene(`üretici gerçek: Türkçe locres geri okununca ${en.girisler.length} giriş, tutarlı, sürüm 3`, geri.tutarli && geri.surum === 3 && geri.girisler.length === en.girisler.length);
    dene('üretici gerçek: ad alanı, anahtar ve üç karma İngilizce ile aynı; başlık anahtarı OLMAYAN her değer Türkçe[kimlik] (0 → boş)',
      geri.girisler.every((t, i) => { const e = en.girisler[i]; const id = indeks.eslesme[i][3];
        return t.ns === e.ns && t.key === e.key && t.kaynakHash === e.kaynakHash && t.nsHash === e.nsHash && t.keyHash === e.keyHash && (baslikMi(e) || t.deger === (id === 0 ? '' : ceviri[String(id)])); }));
    dene('üretici gerçek: başlık anahtarlarında değer Türkçe[kimlik]\'ten yalnız "yer tutucu dışında i → İ" kadar farklı (bağımsız kural, baslikYazisi çağrılmaz)',
      geri.girisler.every((t, i) => { const e = en.girisler[i]; const id = indeks.eslesme[i][3];
        return !baslikMi(e) || baslikDegerSorunu(t.deger, id === 0 ? '' : ceviri[String(id)]) === null; }));
    dene('üretici gerçek: sayılar tutuyor (boş + çevrilen benzersiz kimlik = toplam çeviri sayısı ile uyumlu)', tr.sayilar.toplam === en.girisler.length && tr.sayilar.cevrilen === Object.keys(ceviri).length);
    dene(`üretici gerçek: başlık listesindeki ${baslik.length} anahtarın hepsi locres'te bulundu, en az biri gerçekten değişti`,
      tr.sayilar.baslik === baslik.length && tr.sayilar.baslikDegisen > 0 && tr.sayilar.baslikDegisen <= baslik.length);
    const pakYolu = u.yol;
    dene('üretici gerçek: pak diske yazılıp geri okununca çıkış kapısı sorunsuz', u.sorun.length === 0);

    const kopya = (o) => structuredClone(o);
    const sil = (o, k) => { const c = kopya(o); delete c[k]; return c; };
    const kimlik1 = String(indeks.eslesme.find(e => e[3] !== 0)[3]);
    const kur = (olay) => () => trLocresKur({ en, eslesme: indeks.eslesme, ceviri, kaynakEn, baslik, ...olay });
    // Başlık anahtarı OLMAYAN, kimliği 0 olmayan bir örnek giriş: değer/karma bozma testleri bunun üzerinde (başlık girişinde bozma, kapının
    // başka iletisini de tetikler ve "tek kontrol" sınaması bulanır)
    const ornek = tr.girisler.findIndex((_, i) => indeks.eslesme[i][3] !== 0 && !baslikMi(en.girisler[i]));
    dene('üretici hata: eksik çeviri reddediliyor', firlatir(kur({ ceviri: sil(ceviri, kimlik1) }), /çeviri yok/));
    dene('üretici hata: boş çeviri reddediliyor', firlatir(kur({ ceviri: { ...ceviri, [kimlik1]: '' } }), /boş ya da metin değil/));
    dene('üretici hata: hiçbir girişe bağlı olmayan fazla kimlik reddediliyor', firlatir(kur({ ceviri: { ...ceviri, 999999: 'fazla' } }), /hiçbir girişe bağlı değil/));
    const kimlik0lu = kopya(indeks.eslesme); const hedef = kimlik0lu.findIndex(e => e[3] !== 0); kimlik0lu[hedef][3] = 0;
    dene('üretici hata: kimlik 0 (boş metin) ama İngilizce metin boş değil reddediliyor', firlatir(kur({ eslesme: kimlik0lu }), /kimlik 0/));
    dene('üretici hata: kaynak metni locres değeriyle tutmuyorsa reddediliyor', firlatir(kur({ kaynakEn: { ...kaynakEn, [kimlik1]: kaynakEn[kimlik1] + ' (değişti)' } }), /locres değeriyle tutmuyor/));
    const kaymis = kopya(indeks.eslesme); [kaymis[0], kaymis[1]] = [kaymis[1], kaymis[0]];
    dene('üretici hata: eşleşme sırası İngilizce girişlerle kaymışsa reddediliyor', firlatir(kur({ eslesme: kaymis }), /girişte İngilizce locres ile tutmuyor/));
    dene('üretici hata: eşleşme giriş sayısı eksikse reddediliyor', firlatir(kur({ eslesme: indeks.eslesme.slice(0, -1) }), /build değişmiş olabilir/));
    const bozukTr = kopya(tr.girisler); bozukTr[ornek].deger += '!';
    const bozukYol = join(gecici, 'bozuk_P.pak'); writeFileSync(bozukYol, yamaPakKur(trLocresBayt(bozukTr)));
    dene('çıkış kapısı karşı test: bir değeri değiştirilmiş yama pakı yakalanıyor', kapiSorunlari(bozukYol, locres, en, indeks.eslesme, ceviri, baslik).length > 0);
    const kopukYol = join(gecici, 'yanlis-yol.pak'); writeFileSync(kopukYol, pakYaz({ dosyalar: [{ yol: 'Yanlis/Game.locres', veri: locres }] }));
    dene('çıkış kapısı karşı test: yolu yanlış pak yakalanıyor', kapiSorunlari(kopukYol, locres, en, indeks.eslesme, ceviri, baslik).some(s => /yolu/.test(s)));
    // gerçek veride hiç kullanılmayan boş metin (kimlik 0) dalı: yalnız sentetik
    const sEn = { girisler: [g('N', 'bos', 1, '', 5, 6), g('N', 'dolu', 2, 'Hi', 5, 7)] };
    const sT = trLocresKur({ en: sEn, eslesme: [['N', 'bos', 1, 0], ['N', 'dolu', 2, 1]], ceviri: { 1: 'Selam' }, kaynakEn: { 1: 'Hi' } });
    dene('üretici sentetik: boş metin (kimlik 0) boş kalıyor, öteki Türkçe oluyor, sayılar 2/1/1', sT.girisler[0].deger === '' && sT.girisler[1].deger === 'Selam' && sT.sayilar.bos === 1 && sT.sayilar.cevrilen === 1 && sT.sayilar.toplam === 2);

    // ---------------- D: bozma turunda (tools/taslak/bozma-yazici.mjs, 12.11.2026) KAÇAN bozmalara karşı testler
    // D1 (B102 B103): testler sabiti kendisi import ettiği için sabit değiştirilince hiçbir test düşmüyordu; sabit, gerçek oyundan türetilen
    // değerle karşılaştırılır. "en" olsa yama oyunun İngilizce locres'ini ezerdi; `_P` eki düşse yama önceliği kaybolurdu (öncelik ÖLÇÜLMEDİ).
    let enYolu = null, enPakAdi = null;
    for (const pk of paketler) { const y = pk.liste().find(x => /Localization\/Game\/en\/Game\.locres$/.test(x.yol)); if (y) { enYolu = y.yol; enPakAdi = pk.yol.split(/[\\/]/).pop(); break; } }
    dene('yama sabitleri: locres yolu, oyunun en/Game.locres yolunun "tr" karşılığı ("en" olsa yama İngilizce metni ezerdi)',
      !!enYolu && YAMA_LOCRES_YOLU === enYolu.replace('/en/', '/tr/') && YAMA_LOCRES_YOLU !== enYolu && /\/tr\/Game\.locres$/.test(YAMA_LOCRES_YOLU));
    dene('yama sabitleri: pak adı, locres\'i taşıyan oyun pakının adı + "_P" eki', !!enPakAdi && YAMA_PAK_ADI === enPakAdi.replace(/\.pak$/, '_P.pak') && YAMA_PAK_ADI.endsWith('_P.pak'));

    // D2 (B70): kök dosyası olmayan pakta kök satırı. Yama pakı tam böyle bir pak (kök + 5 üst klasör, dosya yalnız en alttaki klasörde).
    const yamaPk = pakAc(pakYolu); acilanlar.push(yamaPk);
    const yamaDizinler = yamaPk.klasorler();
    const yamaBeklenen = ['', ...YAMA_LOCRES_YOLU.split('/').slice(0, -1).map((_, n, a) => a.slice(0, n + 1).join('/') + '/')];
    dene('yama pakı: klasör satırları = kök + 5 üst klasör; kökte 0 dosya, en alttaki klasörde 1 dosya',
      yamaDizinler.length === 6 && yamaDizinler.map(k => k.dizin).sort().join('|') === [...yamaBeklenen].sort().join('|') &&
      yamaDizinler.find(k => k.dizin === '').dosyaSayisi === 0 && yamaDizinler.find(k => k.dizin === yamaBeklenen.at(-1)).dosyaSayisi === 1);
    const kdYol = join(gecici, 'kokdosyasiz.pak'); writeFileSync(kdYol, pakYaz({ dosyalar: [{ yol: 'Dir/Sub/x.bin', veri: Buffer.from('x') }] }));
    const kdPk = pakAc(kdYol); acilanlar.push(kdPk);
    dene('pak sentetik: kök dosyasız pakta da kök satırı var (kök + Dir/ + Dir/Sub/, kökte 0 dosya)',
      kdPk.klasorler().map(k => k.dizin).sort().join('|') === ['', 'Dir/', 'Dir/Sub/'].join('|') && kdPk.klasorler().find(k => k.dizin === '').dosyaSayisi === 0);

    // D3 (B83 B84 B85 B91): üreticideki eşleşme alanları; kayma testi yalnız iki girişin yerini değiştiriyordu, her alan ayrı bozulur.
    const alanBoz = (n, f) => { const e = kopya(indeks.eslesme); e[7][n] = f(e[7][n]); return e; };
    const tutmaz = /girişte İngilizce locres ile tutmuyor/;
    dene('üretici hata: eşleşmede yalnız ad alanı farklıysa reddediliyor', firlatir(kur({ eslesme: alanBoz(0, v => v + 'X') }), tutmaz));
    dene('üretici hata: eşleşmede yalnız anahtar farklıysa reddediliyor', firlatir(kur({ eslesme: alanBoz(1, v => v + 'X') }), tutmaz));
    dene('üretici hata: eşleşmede yalnız kaynakHash farklıysa reddediliyor', firlatir(kur({ eslesme: alanBoz(2, v => (v + 1) % 2 ** 32) }), tutmaz));
    dene('üretici hata: kaynak parçalarında kimliği olmayan metin reddediliyor', firlatir(kur({ kaynakEn: sil(kaynakEn, kimlik1) }), /kaynak parçalarında yok/));

    // D4 (B104-B116): çıkış kapısının her kontrolü tek başına sınanır. Pak, yalnız o kontrolün görebileceği TEK kusurla yazılır ve
    // beklenen locres baytı o pakın kendisi verilir (bayt eşitliği öteki katmanı örtmesin); `yalniz`: başka sorun çıkmamalı.
    let kapiNo = 0;
    const kapiKos = (locresBayt, beklenen = locresBayt, dosyalar = null) => {
      const y = join(gecici, `kapi-${++kapiNo}_P.pak`); writeFileSync(y, dosyalar ? pakYaz({ dosyalar }) : yamaPakKur(locresBayt));
      return kapiSorunlari(y, beklenen, en, indeks.eslesme, ceviri, baslik);
    };
    const yalniz = (s, desen) => s.length === 1 && desen.test(s[0]);
    dene('çıkış kapısı (tek kontrol): pakta 2 dosya varsa yakalanıyor', yalniz(kapiKos(null, locres, [{ yol: YAMA_LOCRES_YOLU, veri: locres }, { yol: 'Ek/dosya.txt', veri: Buffer.from('x') }]), /pakta 2 dosya var/));
    dene('çıkış kapısı (tek kontrol): paktaki locres beklenen baytlardan farklıysa yakalanıyor', yalniz(kapiKos(locres, Buffer.concat([locres, Buffer.from([0])])), /baytları kurulan locres ile aynı değil/));
    const sayacBoz = Buffer.from(locres); sayacBoz.writeUInt32LE(sayacBoz.readUInt32LE(25) + 1, 25);
    dene('çıkış kapısı (tek kontrol): tutarsız locres yakalanıyor (karşı test: bozuk locres gerçekten tutarsız okunuyor)', !locresCoz(sayacBoz).tutarli && kapiKos(sayacBoz).some(s => /tutarsız/.test(s)));
    dene('çıkış kapısı (tek kontrol): giriş sayısı İngilizce ile farklıysa yakalanıyor', kapiKos(trLocresBayt(tr.girisler.slice(0, -1))).some(s => /giriş sayısı \d+, İngilizce \d+/.test(s)));
    const bozuk = (f) => { const t = kopya(tr.girisler); f(t); return trLocresBayt(t); };
    const kimlikDesen = /ad alanı\/anahtar\/karma İngilizce ile farklı/;
    const nsOrnek = tr.girisler[ornek].ns;
    for (const [ad, f] of [
      ['ad alanı', t => { t[ornek].ns = 'ZZ_sinama'; }],
      ['anahtar', t => { t[ornek].key += 'X'; }],
      ['kaynakHash', t => { t[ornek].kaynakHash = (t[ornek].kaynakHash + 1) % 2 ** 32; }],
      ['nsHash', t => { for (const x of t) if (x.ns === nsOrnek) x.nsHash = (x.nsHash + 1) % 2 ** 32; }],
      ['keyHash', t => { t[ornek].keyHash = (t[ornek].keyHash + 1) % 2 ** 32; }],
    ]) dene(`çıkış kapısı (tek kontrol): yalnız ${ad} İngilizce'den farklıysa yakalanıyor`, yalniz(kapiKos(bozuk(f)), kimlikDesen));
    dene('çıkış kapısı (tek kontrol): yalnız bir değer Türkçe[kimlik]\'ten farklıysa yakalanıyor', yalniz(kapiKos(bozuk(t => { t[ornek].deger += '!'; })), /değer Türkçe\[kimlik\] ile farklı/));
    // kimlik 0 (boş metin) dalı gerçek veride yok: sentetik küçük İngilizce + eşleşme + çeviri ile
    const kEn = { girisler: [g('N', 'bos', 1, '', 5, 6), g('N', 'dolu', 2, 'Hi', 5, 7)] };
    const kosKucuk = (girisler) => {
      const b = trLocresBayt(girisler); const y = join(gecici, `sent-kapi-${++kapiNo}_P.pak`); writeFileSync(y, yamaPakKur(b));
      return kapiSorunlari(y, b, kEn, [['N', 'bos', 1, 0], ['N', 'dolu', 2, 1]], { 1: 'Selam' }, []);
    };
    dene('çıkış kapısı sentetik: kimlik 0 girişi boş, ötekisi Türkçe ise sorunsuz', kosKucuk(sT.girisler).length === 0);
    dene('çıkış kapısı sentetik: kimlik 0 girişinde boş olmayan değer yakalanıyor', yalniz(kosKucuk([{ ...sT.girisler[0], deger: 'dolu' }, sT.girisler[1]]), /değer Türkçe\[kimlik\] ile farklı/));

    // D5 (B41 B65 B66): okuyucunun bakmadığı baytlar. Yazıcı bozulunca okuyucu aynı şekilde okuyordu; motor bu alanlara bakabilir.
    // Önce GERÇEK paklarda ölçülür (kodlanmış giriş bayrağı, tablo uzunluğu, yol karması bloğunun sonu), sonra yazılan pakın aynısı olması beklenir.
    // Yol karması bloğunun sonu: eskiden "son 4 bayt 0" diye sınanıyordu (tablo hep boştu). Budanmış klasör tablosu gelince son 4 bayt son
    // klasörün dosya sayısı oldu (0 olması rastlantı), bu yüzden ölçüt "okuyucu bloğu tam tüketiyor" oldu (`budanmisDizin()` artık bayt bulursa hata verir).
    const kodTablosu = (yol, p) => {
      const bas = p.indeksOfset + p.baglamaNoktasi.length + 5 + 4 + 8 + 80;   // fstr(bağlama) | giriş sayısı | tohum | 2 × (var bayrağı + ofset + boyut + SHA1)
      const uz = okuAralik(yol, bas, 4).readInt32LE(0);
      return { uz, bayt: okuAralik(yol, bas + 4, uz) };
    };
    const bayrakTamam = (t) => { for (let o = 0; o < t.uz; o += 12) if (t.bayt.readUInt32LE(o) !== 0xE0000000) return false; return true; };
    const tabloTamam = (yol, p) => { const t = kodTablosu(yol, p); return t.uz === 12 * p.girisSayisi && bayrakTamam(t); };
    const sonTamam = (yol, p) => hataNull(() => p.budanmisDizin()) !== null;
    const sonAd = 'yol karması bloğu karma tablosu + budanmış klasör tablosuyla TAM doluyor (okuyucu bloğun sonunda artık bayt bulmuyor)';
    const tabloAd = 'kodlanmış giriş tablosu 12 × dosya sayısı bayt ve her giriş 0xE0000000 bayrağıyla';
    for (const pk of paketler) {
      const ad = pk.yol.split(/[\\/]/).pop();
      dene(`pak gerçek ${ad}: ${sonAd}`, sonTamam(pk.yol, pk));
      // 4 GiB üstü pakta (pakchunk0) girişler değişken uzunlukta (12 ya da 16 bayt, bayrak 0x60000000 gibi; ölçüldü): yazıcı hep 12 baytlık
      // yazar (4 GiB sınırı denetlenir), bu yüzden tablo kıyası yalnız 4 GiB altı gerçek paklarla yapılır.
      if (statSync(pk.yol).size < 2 ** 32) dene(`pak gerçek ${ad}: ${tabloAd}`, tabloTamam(pk.yol, pk));
    }
    for (const [ad, yol, p] of [['pak sentetik', spYol, spk], ['yama pakı', pakYolu, yamaPk]]) {
      dene(`${ad}: gerçek paklardaki düzenin aynısı (${sonAd}; ${tabloAd})`, sonTamam(yol, p) && tabloTamam(yol, p));
    }

    // ---------------- E: budanmış klasör tablosu (yol karması bloğunun sonu): yazıcı kuralı `budanmisKume` ↔ okuyucu `budanmisDizin`.
    // Gerçek paklarda kural, okunan tabloyla klasör kümesi, kodOfset'ler, dosyalı klasörlerin sırası ve klasör içi dosya sırası dahil birebir
    // aynı olmalı (ölçüldü: pakchunk0 242 ↔ 242 klasör, pakchunk1 boş ↔ boş). Sentetik testler, gerçek paklarda ÖLÇÜLEMEYEN dalları
    // (büyük harfli uzantı, kökte .uplugin, .upluginmanifest) YAZICININ SEÇİMİ olarak kaydeder: gerçek pakta büyük harfli uzantı yok, tek
    // .upluginmanifest'in yanında .uplugin ve Content/ yok; yani bu testler motorun yaptığını değil yazıcının yaptığını sınar.
    // Uzantı beyaz listesi bilerek burada ayrıca yazılı: kural sabitini import etmek, sabit bozulunca testi de bozardı (D1 dersi).
    const kumeSozlugu = (k) => new Map(k.map(x => [x.dizin, x.dosyalar.map(d => `${d.ad}\t${d.kodOfset}`).join('\n')]));
    const kumeFarki = (a, b) => {       // iki yönde farklı klasör sayısı (klasör adı tekrarı da fark sayılır)
      const A = kumeSozlugu(a), B = kumeSozlugu(b);
      let n = Math.abs(a.length - A.size) + Math.abs(b.length - B.size);
      for (const [d, v] of A) if (B.get(d) !== v) n++;
      for (const d of B.keys()) if (!A.has(d)) n++;
      return n;
    };
    const esitMi = (a, b) => { try { deepStrictEqual(a, b); return true; } catch { return false; } };
    const dosyaliSirasi = (k) => k.filter(x => x.dosyalar.length).map(x => `${x.dizin}\t${x.dosyalar.map(d => d.ad).join('|')}`).join('\n');
    // ham ad biçimi: kök "/" (tablo doluysa tam bir kez), ötekilerde başta "/" yok, sonda "/" var; boş ad ("") geçersiz
    const hamAdTamam = (k) => k.every(x => x.dizin === '/' || (!x.dizin.startsWith('/') && x.dizin.endsWith('/'))) && k.filter(x => x.dizin === '/').length === (k.length ? 1 : 0);
    const uplugin0 = (k) => {           // okunan tabloda .uplugin klasörünün Content/'u ve altındaki 0 dosyalı klasörlerin sayısı (kuraldan bağımsız sayım)
      const c = k.filter(x => x.dosyalar.some(d => /\.uplugin$/i.test(d.ad))).map(x => (x.dizin === '/' ? '' : x.dizin) + 'Content/');
      return k.filter(x => x.dosyalar.length === 0 && c.some(p => x.dizin.startsWith(p))).length;
    };
    const gercekTablolar = [];
    for (const pk of paketler) {
      const ad = pk.yol.split(/[\\/]/).pop();
      const okunan = hataNull(() => pk.budanmisDizin());
      const kural = budanmisKume(pk.liste().map(x => ({ yol: x.yol, kodOfset: x.kodOfset })));
      gercekTablolar.push(okunan);
      dene(`budanmış tablo gerçek ${ad}: okuyucu bloğu tam tüketiyor ve kuralın klasör kümesi okunan tabloyla birebir (${kural.length} ↔ ${okunan ? okunan.length : 'okunamadı'} klasör; dosya adı ve kodOfset dahil)`,
        !!okunan && kural.length === okunan.length && kumeFarki(kural, okunan) === 0);
      dene(`budanmış tablo gerçek ${ad}: dosyalı klasörlerin sırası ve klasör içi dosya sırası okunan tabloyla aynı`, !!okunan && dosyaliSirasi(kural) === dosyaliSirasi(okunan));
      dene(`budanmış tablo gerçek ${ad}: ham ad biçimi (kök "/" bir kez, ötekilerde başta "/" yok sonda "/")`, !!okunan && hamAdTamam(okunan) && hamAdTamam(kural));
      if (kural.length === 0) dene(`budanmış tablo gerçek ${ad}: tablo boşken yol karması bloğu tam 8 + 12 × dosya sayısı bayt`, pk.yolHashBoyut === 8 + 12 * pk.girisSayisi);
    }
    const upSayisi = gercekTablolar.reduce((s, t) => s + (t ? uplugin0(t) : 0), 0);
    dene(`budanmış tablo gerçek: karşı test, okunan tabloda .uplugin/Content/ altında ${upSayisi} dosyasız klasör var (kuralın .uplugin dalı gerçek pakta karşı sınanıyor)`, upSayisi > 0);
    dene('budanmış tablo gerçek: karşı test, tablo bir gerçek pakta dolu ötekinde boş (iki dal da gerçek pakta karşı sınanıyor)',
      gercekTablolar.some(t => t && t.length > 0) && gercekTablolar.some(t => t && t.length === 0));

    // sentetik kural: yollar → beklenen dosyalı klasörler ("klasör=ad,ad" adlar sıralı) ve 0 dosyalı klasörler; başka klasör olmamalı
    const kumeYolu = (yollar) => budanmisKume(yollar.map((yol, i) => ({ yol, kodOfset: i * 12 })));
    const dosyalilar = (k) => k.filter(x => x.dosyalar.length).map(x => `${x.dizin}=${x.dosyalar.map(d => d.ad).sort().join(',')}`).sort().join('|');
    const dosyasizlar = (k) => k.filter(x => !x.dosyalar.length).map(x => x.dizin).sort().join('|');
    const kuralTamam = (yollar, dosyaliBek, dosyasizBek) => {
      const k = kumeYolu(yollar);
      return k.length === dosyaliBek.length + dosyasizBek.length && dosyalilar(k) === [...dosyaliBek].sort().join('|') && dosyasizlar(k) === [...dosyasizBek].sort().join('|');
    };
    dene('budanmış tablo sentetik: uzantı beyaz listesi (10 uzantı girer; .uasset .uexp .txt, ".ini" ile bitmeyen .inix ve .xini, uzantısız "ini", .upluginx girmez)',
      kuralTamam(['W/a.ini', 'W/a.icu', 'W/a.cfu', 'W/a.res', 'W/a.nrm', 'W/a.brk', 'W/a.locmeta', 'W/a.locres', 'W/a.uplugin', 'W/a.upluginmanifest',
        'W/a.uasset', 'W/a.uexp', 'W/a.txt', 'W/a.inix', 'W/a.xini', 'W/ini', 'W/a.upluginx'],
      ['W/=a.brk,a.cfu,a.icu,a.ini,a.locmeta,a.locres,a.nrm,a.res,a.uplugin,a.upluginmanifest'], ['/']));
    dene('budanmış tablo sentetik: büyük harfli uzantı (.INI, .UPLUGIN) beyaz listeye girer ve .UPLUGIN kuralı tetikler (yazıcının SEÇİMİ, gerçek pakta ölçülemedi)',
      kuralTamam(['Plug/P.UPLUGIN', 'Plug/Content/Sub/f.uasset', 'Plug/Content/g.UASSET', 'Q/Z.INI'], ['Plug/=P.UPLUGIN', 'Q/=Z.INI'], ['/', 'Plug/Content/', 'Plug/Content/Sub/']));
    dene('budanmış tablo sentetik: kökte dosya (Root.ini) → kök "/" dosyalı, kök ayrıca 0 dosyalı satır olarak girmiyor; listede olmayan uzantılı klasör girmiyor',
      kuralTamam(['Root.ini', 'a/b.txt'], ['/=Root.ini'], []));
    dene('budanmış tablo sentetik: beyaz listede dosya yoksa tablo boş (kök de yok)', kuralTamam(['a/b.uasset', 'c.txt', 'd/e/f.uexp'], [], []));
    dene('budanmış tablo sentetik: dosyasız ara klasörler 0 dosyalı girer (A/B/C/d.res → kök, A/, A/B/)', kuralTamam(['A/B/C/d.res'], ['A/B/C/=d.res'], ['/', 'A/', 'A/B/']));
    dene('budanmış tablo sentetik: .uplugin kuralı: U/Content/ ve altında dosya taşıyan bütün klasörler 0 dosyalı girer; U/Other/ ve U/ContentX/ girmez',
      kuralTamam(['Plug/P.uplugin', 'Plug/Content/Sub/Deep/f.uasset', 'Plug/Other/g.uasset', 'Plug/ContentX/h.uasset'],
        ['Plug/=P.uplugin'], ['/', 'Plug/Content/', 'Plug/Content/Sub/', 'Plug/Content/Sub/Deep/']));
    dene('budanmış tablo sentetik: .uplugin kuralı derin klasörde (Game/Plugins/Q/), Content/ altındaki ara klasör ve Content/ tek dosyası dahil; Source/ girmez',
      kuralTamam(['Game/Plugins/Q/Q.uplugin', 'Game/Plugins/Q/Content/c.uasset', 'Game/Plugins/Q/Content/M/d.uasset', 'Game/Plugins/Q/Source/e.uasset'],
        ['Game/Plugins/Q/=Q.uplugin'], ['/', 'Game/', 'Game/Plugins/', 'Game/Plugins/Q/Content/', 'Game/Plugins/Q/Content/M/']));
    dene('budanmış tablo sentetik: kökte .uplugin → Content/ girer, Other/ girmez (kök yolunda "" + "Content/")',
      kuralTamam(['P.uplugin', 'Content/x.uasset', 'Other/y.uasset'], ['/=P.uplugin'], ['Content/']));
    dene('budanmış tablo sentetik: .uplugin var ama Content/ yok → ek klasör girmez', kuralTamam(['Solo/S.uplugin', 'Solo/Other/o.uasset'], ['Solo/=S.uplugin'], ['/']));
    dene('budanmış tablo sentetik: Content/ var ama .uplugin yok → Content/ girmez (kural yalnız .uplugin dosyalı klasör için)',
      kuralTamam(['Plain/p.ini', 'Plain/Content/x.uasset'], ['Plain/=p.ini'], ['/']));
    dene('budanmış tablo sentetik: .uplugin olmayan komşunun Content/ klasörü girmez (Other/Content/)',
      kuralTamam(['Plug/P.uplugin', 'Plug/Content/a.uasset', 'Other/Content/b.uasset'], ['Plug/=P.uplugin'], ['/', 'Plug/Content/']));
    dene('budanmış tablo sentetik: .upluginmanifest tek başına .uplugin kuralını tetiklemez (yazıcının SEÇİMİ; gerçek pakta ölçülemedi)',
      kuralTamam(['M/m.upluginmanifest', 'M/Content/x.uasset'], ['M/=m.upluginmanifest'], ['/']));
    dene('budanmış tablo sentetik: sıra: dosyalı klasörler küçük harfle sıralı (a/ < B/ < c/), klasör içi dosyalar kodOfset artan (y.ini adı b.ini\'den sonra ama kodOfset\'i önce)',
      dosyaliSirasi(kumeYolu(['c/x.ini', 'B/k.ini', 'a/y.ini', 'a/b.ini'])) === 'a/\ty.ini|b.ini\nB/\tk.ini\nc/\tx.ini');

    // yazıcı ↔ okuyucu: yazılan pakın tablosu, aynı girdiye uygulanan kuralla (sıra dahil) birebir ve her dosyanın kodOfset'i liste() ile aynı
    const eYollar = ['Root.ini', 'W/a.ini', 'W/a.locres', 'W/a.txt', 'A/B/C/d.res', 'Plug/P.UPLUGIN', 'Plug/Content/Sub/Deep/f.uasset', 'Plug/Other/g.uasset',
      'Plug/ContentX/h.uasset', 'Game/Plugins/Q/Q.uplugin', 'Game/Plugins/Q/Content/c.uasset', 'Solo/S.uplugin', 'Solo/Other/o.uasset',
      'Plain/p.ini', 'Plain/Content/x.uasset', 'Z/u.uasset', 'c/x.ini', 'B/k.ini'];
    const ePkYol = join(gecici, 'budanmis.pak');
    writeFileSync(ePkYol, pakYaz({ dosyalar: eYollar.map(yol => ({ yol, veri: Buffer.from(yol) })) }));
    const ePk = pakAc(ePkYol); acilanlar.push(ePk);
    const eOkunan = hataNull(() => ePk.budanmisDizin());
    dene('budanmış tablo sentetik pak: yaz → oku, okuyucu bloğu tam tüketiyor ve okunan tablo kuralla birebir (klasör ve dosya sırası dahil)', !!eOkunan && esitMi(eOkunan, kumeYolu(eYollar)));
    const eListe = new Map(ePk.liste().map(x => [x.yol, x.kodOfset]));
    const eBeyaz = /\.(ini|icu|cfu|res|nrm|brk|locmeta|locres|uplugin|upluginmanifest)$/i;
    const eTablodaki = eOkunan ? eOkunan.flatMap(x => x.dosyalar.map(d => (x.dizin === '/' ? '' : x.dizin) + d.ad)) : [];
    dene('budanmış tablo sentetik pak: tablodaki her dosyanın kodOfset\'i liste() ile aynı ve beyaz listedeki her dosya tabloda (fazlası yok)',
      !!eOkunan && eOkunan.every(x => x.dosyalar.every(d => eListe.get((x.dizin === '/' ? '' : x.dizin) + d.ad) === d.kodOfset)) &&
      [...eTablodaki].sort().join('|') === eYollar.filter(y => eBeyaz.test(y)).sort().join('|'));
    dene('budanmış tablo sentetik pak: ham ad biçimi (kök "/", ötekilerde başta "/" yok sonda "/")', !!eOkunan && hamAdTamam(eOkunan));
    dene('budanmış tablo sentetik pak: beyaz listede dosya yoksa (a.txt, .bin) tablo boş ve yol karması bloğu tam 8 + 12 × dosya sayısı bayt',
      hataNull(() => spk.budanmisDizin())?.length === 0 && spk.yolHashBoyut === 8 + 12 * spk.girisSayisi);
    // karşı test: okuyucunun yapı denetimi çalışıyor (klasör sayısı bir eksik yazılırsa blokta artık bayt kalır)
    const ePkBayt = readFileSync(ePkYol);
    ePkBayt.writeUInt32LE(eOkunan.length - 1, ePk.yolHashOfset + 4 + 12 * ePk.girisSayisi);
    const eBozukYol = join(gecici, 'budanmis-bozuk.pak'); writeFileSync(eBozukYol, ePkBayt);
    const eBozuk = pakAc(eBozukYol); acilanlar.push(eBozuk);
    dene('budanmış tablo karşı test: klasör sayısı bir eksik yazılmış pakta okuyucu "bayt artık var" hatası veriyor (tam tüketim denetimi gerçekten çalışıyor)', firlatir(() => eBozuk.budanmisDizin(), /bayt artık var/));

    // yama pakı: tr/ klasöründe Game.locres (kodOfset 0) + 5 üst klasör (kök "/" dahil), hepsi 0 dosyalı
    const yamaTablo = hataNull(() => yamaPk.budanmisDizin());
    const yamaHam = yamaBeklenen.map(d => (d === '' ? '/' : d));
    dene('budanmış tablo yama pakı: 6 klasör (tr/ + 5 üst klasör, kök "/" dahil), yalnız tr/ dosyalı ve içinde Game.locres kodOfset 0',
      !!yamaTablo && yamaTablo.length === 6 && yamaTablo.map(x => x.dizin).sort().join('|') === [...yamaHam].sort().join('|') && yamaTablo.filter(x => x.dosyalar.length).length === 1 &&
      yamaTablo.find(x => x.dizin === yamaBeklenen.at(-1)).dosyalar.map(d => `${d.ad}:${d.kodOfset}`).join() === 'Game.locres:0' && hamAdTamam(yamaTablo));

    // ---------------- F: oyunun paklarını okuyan araçlar pak adı süzmeyi ortak `oyunPakAdlari`dan yapar (`_P.pak` kuralı kapıda).
    // Eskiden aynı süzme üç araçta kopya satırdı ve ikisinde unutulmuştu (13.11.2026): yama paketi oyunun paklarına karışırdı ve bozuk bir
    // `_P.pak` aracı çökertirdi. Sentetik ad listesi dosya açmaz (27 GB gerekmez); giriş bilerek sırasız, sıralama da sınanır.
    // Harf büyüklüğü varyantları (`_p.pak`, `.PAK`) pinli DEĞİL: UE'nin eki harf duyarlı sayıp saymadığı ölçülmedi.
    // Bu testler şunu GÖREMEZ: araçların gerçek bir oyun klasöründe `_P.pak`ı atladığını (yalnız ad listesi ve kaynak metni sınanır;
    // gerçek klasörle ölçüm 13.11.2026'da elle, hardlinkli sahte klasörlerle yapıldı, kalıcı değil) · kopya süzmenin başka yazımlarını
    // (tarama yalnız `endsWith` ile `.pak` yazımını arar) · `tools/taslak/` altını (taslak, kasıtlı hariç).
    // Elle ölçüm düzeneği (yeniden kurulacaksa): proje DIŞINDA sahte `<A>/ModernStoryteller01/Content/Paks/`; oyunun 27 GB'lık `pakchunk0`ı
    // KOPYALANMAZ, PowerShell'de `New-Item -ItemType HardLink -Path <sahte klasör>/<aynı ad> -Target <gerçek pak>` (aynı sürücüde yönetici
    // gerekmez, çalıştı); küçük `pakchunk1` kopyalanır; araçlara `--oyun <sahte klasör>` verilir. İş bitince sahte klasör silinir
    // (`Remove-Item -Recurse`) ve gerçek paklar dokunulmamış mı ölçülür (boyutları işten önce ve sonra `Get-Item` ile karşılaştır).
    const adlar = ['pakchunk1.pak', 'a.pak', 'b_P.pak', '_P.pak', 'c.txt', 'd.pak.bak', YAMA_PAK_ADI, 'pakchunk0.pak', 'z.pak'];
    const adlarOnce = adlar.join('|');
    dene('pak adı süzme: yalnız oyunun kendi paklarını sıralı verir (.pak ile biten, _P.pak ile bitmeyen); yama paketleri, .txt ve .pak.bak elenir, girdi değişmez',
      JSON.stringify(oyunPakAdlari(adlar)) === JSON.stringify(['a.pak', 'pakchunk0.pak', 'pakchunk1.pak', 'z.pak']) && adlar.join('|') === adlarOnce);
    dene('pak adı süzme: kendi yama paketimizin adı (YAMA_PAK_ADI) oyunun paklarına girmez, boş liste boş döner',
      JSON.stringify(oyunPakAdlari([YAMA_PAK_ADI, 'x.pak'])) === JSON.stringify(['x.pak']) && oyunPakAdlari([]).length === 0);
    const KOPYA_SUZME = /endsWith\(['"]\.pak['"]\)/;
    for (const ad of ['yama-uret.mjs', 'ceviri-kaynak.mjs', 'oyun-haritasi.mjs']) {
      const kaynak = readFileSync(join(KOK, 'tools', ad), 'utf8');
      dene(`pak adı süzme: tools/${ad} süzmeyi ortak fonksiyondan yapıyor (oyunPakAdlari(readdirSync(PAKLAR)) çağrısı var, kendi süzmesi yok)`,
        /oyunPakAdlari\(readdirSync\(PAKLAR\)\)/.test(kaynak) && !KOPYA_SUZME.test(kaynak));
    }
    const kopyalar = [
      ...readdirSync(join(KOK, 'tools')).filter(a => a.endsWith('.mjs')).map(a => join('tools', a)),
      ...readdirSync(join(KOK, 'tools', 'lib')).filter(a => a.endsWith('.mjs') && a !== 'pak.mjs').map(a => join('tools', 'lib', a)),
    ].filter(y => KOPYA_SUZME.test(readFileSync(join(KOK, y), 'utf8')));
    dene(`pak adı süzme: tools/ ve tools/lib/ altında (pak.mjs ve taslak/ hariç) kopya süzme yok${kopyalar.length ? ` (kopya: ${kopyalar.join(' ')})` : ''}`, kopyalar.length === 0);

    // ---------------- G: başlık yazı tipi (13.11.2026): `baslikYazisi`, `trLocresKur(baslik)` ve kapının `baslikDegerSorunu` kuralı.
    // Bu koruma yalnız sentetik testte görünür: gerçek veri yer tutucu ve etiket korumasını, `ı` korumasını ve ad alanı ayrımını GÖRMEZ
    // (listedeki tek yer tutucu `{player}`, içinde i yok; aynı anahtarı farklı ad alanında taşıyan giriş yok).
    // Bu testler şunu da göremez: `İ`nin oyunda başlıkta nasıl çizildiğini · listenin (`ceviri/baslik-yazi-tipi.json`) doğru anahtarları
    // içerdiğini (Goudy ile çizildikleri oyunda görülmedi) · `<` ya da `{` yer tutucu OLMADAN geçen bir metinde korumanın yanlışlıkla
    // araya giren metni de saklayacağını (gerçek listede böyle çeviri yok, sentetik denenmedi).
    const by = baslikYazisi;
    dene('başlık yazısı: küçük i → İ, öteki harfler aynen ("Yeni Oyun" → "Yenİ Oyun")', by('Yeni Oyun') === 'Yenİ Oyun');
    dene('başlık yazısı: {yer tutucu} içindeki i korunur, dışındakiler dönüşür', by('Sevgili {player}, iyi {item_i}') === 'Sevgİlİ {player}, İyİ {item_i}');
    dene('başlık yazısı: <etiket> içindeki i korunur (img, id, ikon), aralarındaki metin dönüşür', by('<b>kitabi</b> <img id="ikon"/> bir') === '<b>kİtabİ</b> <img id="ikon"/> bİr');
    dene('başlık yazısı: ı ve zaten büyük İ dokunulmaz', by('Işık İlk ığ') === 'Işık İlk ığ');
    dene('başlık yazısı: boş metin boş kalır', by('') === '');
    dene('başlık yazısı: satır sonu (CRLF) olan metinde de çalışır, satır sonuna dokunmaz', by('bir\r\niki') === 'bİr\r\nİkİ');
    const ornekler = ['Yeni Oyun', 'Sevgili {player}, iyi {item_i}', '<b>kitabi</b> <img id="ikon"/> bir', 'Işık İlk ığ', ''];
    dene('başlık yazısı: ikinci uygulama aynı sonucu verir (idempotent)', ornekler.every(m => by(by(m)) === by(m)));

    // G2: kapının bağımsız kuralı (`baslikYazisi`ni çağırmaz)
    const sorunDesen = (deger, cevirisi, desen) => { const s = baslikDegerSorunu(deger, cevirisi); return s !== null && desen.test(s); };
    dene('başlık kuralı (kapı): doğru dönüşüm null döner (düz, çeviride zaten büyük İ olan, yer tutuculu, etiketli, boş)',
      [['Yenİ Oyun', 'Yeni Oyun'], ['İlk', 'İlk'], ['Sevgİlİ {player}, İyİ {item_i}', 'Sevgili {player}, iyi {item_i}'], ['<b>kİtabİ</b> bİr', '<b>kitabi</b> bir'], ['', '']]
        .every(([d, c]) => baslikDegerSorunu(d, c) === null));
    dene('başlık kuralı (kapı): değer çeviriyle aynen aynıysa ve içinde i varsa sorun (i kalmış)', sorunDesen('Yeni Oyun', 'Yeni Oyun', /noktalı i kalmış/));
    dene('başlık kuralı (kapı): uzunluk farklıysa sorun', sorunDesen('Yenİ Oyunu', 'Yeni Oyun', /^uzunluk farklı$/));
    dene('başlık kuralı (kapı): i → İ dışında değişmiş harf sorun (n → m; çeviride büyük I → İ de sayılmaz; i → I de sorun)',
      sorunDesen('Yenİ Oyum', 'Yeni Oyun', /i → İ dışında değişmiş/) && sorunDesen('İlk', 'Ilk', /i → İ dışında değişmiş/) &&
      sorunDesen('YenI Oyun', 'Yeni Oyun', /i → İ dışında değişmiş/));
    dene('başlık kuralı (kapı): yer tutucu ya da etiket içinde i → İ yapılmışsa sorun ({plaier}, {i}, <img/>)',
      sorunDesen('Sevgİlİ {plaİer}', 'Sevgili {plaier}', /yer tutucu ya da etiket değişmiş/) && sorunDesen('{İ}', '{i}', /yer tutucu ya da etiket değişmiş/) &&
      sorunDesen('<İmg/>', '<img/>', /yer tutucu ya da etiket değişmiş/));

    // G3: sentetik üretici. Dört giriş AYNI kimliği paylaşır (N/a, N/b, M/c, M/a); M/a yalnız ad alanıyla N/a'dan ayrılır.
    const bEn = { girisler: [g('N', 'a', 1, 'Hi', 5, 10), g('N', 'b', 1, 'Hi', 5, 11), g('M', 'c', 1, 'Hi', 6, 12), g('M', 'a', 1, 'Hi', 6, 13)] };
    const bEsl = [['N', 'a', 1, 1], ['N', 'b', 1, 1], ['M', 'c', 1, 1], ['M', 'a', 1, 1]];
    const bKur = (olay = {}) => trLocresKur({ en: bEn, eslesme: bEsl, ceviri: { 1: 'Yeni {k_i} Oyun' }, kaynakEn: { 1: 'Hi' }, ...olay });
    const bDegerler = (t) => t.girisler.map(x => x.deger).join('|');
    const dogal = 'Yeni {k_i} Oyun', donmus = 'Yenİ {k_i} Oyun';
    const b1 = bKur({ baslik: [['N', 'a']] });
    dene('üretici sentetik (başlık): aynı kimliği paylaşan dört girişten yalnız listedeki N/a İ\'li; N/b, M/c ve ad alanı farklı M/a doğal kalıyor, sayılar 1/1',
      bDegerler(b1) === [donmus, dogal, dogal, dogal].join('|') && b1.sayilar.baslik === 1 && b1.sayilar.baslikDegisen === 1);
    const b2 = bKur({ baslik: [['N', 'a'], ['M', 'c']] });
    dene('üretici sentetik (başlık): iki anahtar listedeyse ikisi dönüşüyor (N/b ve M/a doğal), sayılar 2/2',
      bDegerler(b2) === [donmus, dogal, donmus, dogal].join('|') && b2.sayilar.baslik === 2 && b2.sayilar.baslikDegisen === 2);
    const b3 = bKur({ ceviri: { 1: 'Tamam' }, baslik: [['N', 'a']] });
    dene('üretici sentetik (başlık): listedeki anahtarın çevirisinde i yoksa metin değişmez, baslik 1 ama baslikDegisen 0',
      bDegerler(b3) === 'Tamam|Tamam|Tamam|Tamam' && b3.sayilar.baslik === 1 && b3.sayilar.baslikDegisen === 0);
    dene('üretici sentetik (başlık): liste verilmezse ya da boşsa hiçbir giriş değişmez, sayılar 0/0',
      [bKur(), bKur({ baslik: [] })].every(b => bDegerler(b) === [dogal, dogal, dogal, dogal].join('|') && b.sayilar.baslik === 0 && b.sayilar.baslikDegisen === 0));
    dene('üretici sentetik (başlık): listede olup locres\'te olmayan anahtar reddediliyor (N/yok yok; X/a da yok: ad alanı anahtarın parçası)',
      firlatir(() => bKur({ baslik: [['N', 'yok']] }), /locres'te yok/) && firlatir(() => bKur({ baslik: [['X', 'a']] }), /locres'te yok/));
    dene('üretici sentetik (başlık): aynı anahtar iki kez listedeyse reddediliyor', firlatir(() => bKur({ baslik: [['N', 'a'], ['N', 'a']] }), /iki kez/));
    dene('üretici sentetik (başlık): çift olmayan liste öğesi reddediliyor (tek öğe, üç öğe, sayı, dizi yerine "Na" metni)',
      [[['N']], [['N', 'a', 'x']], [['N', 5]], ['Na']].every(l => firlatir(() => bKur({ baslik: l }), /çiftlerinden/)));

    // G4: çıkış kapısı, gerçek veride, tek iletiyle (`yalniz`); pak yalnız o kontrolün görebileceği TEK kusurla yazılır
    const ytVar = /\{[^{}]*\}|<[^<>]*>/, ytHepsi = /\{[^{}]*\}|<[^<>]*>/g;
    const cevirisi = (i) => (indeks.eslesme[i][3] === 0 ? '' : ceviri[String(indeks.eslesme[i][3])]);
    dene('çıkış kapısı (başlık): başlık anahtarları doğal bırakılmış (i → İ uygulanmamış) pak yakalanıyor',
      yalniz(kapiKos(bozuk(t => { t.forEach((x, i) => { if (baslikMi(en.girisler[i])) x.deger = cevirisi(i); }); })), /başlık girişinde değer Türkçe\[kimlik\]/));
    dene('çıkış kapısı (başlık): İ HER anahtara uygulanmış (listeyi yok sayan) pak yakalanıyor: başlık olmayan girişler çeviriden farklı',
      yalniz(kapiKos(bozuk(t => { for (const x of t) x.deger = baslikYazisi(x.deger); })), /değer Türkçe\[kimlik\] ile farklı/));
    const dogruYol = join(gecici, `kapi-${++kapiNo}_P.pak`); writeFileSync(dogruYol, yamaPakKur(locres));
    dene('çıkış kapısı (başlık): kapıya verilen liste locres\'te olmayan anahtar içeriyorsa yakalanıyor',
      yalniz(kapiSorunlari(dogruYol, locres, en, indeks.eslesme, ceviri, [...baslik, ['', 'YOK_sinama']]), /başlık listesindeki 1 anahtar locres'te yok/));
    dene('çıkış kapısı (başlık): kapıya boş liste verilirse İ\'li başlık girişleri çeviriden farklı sayılır (kapı kuralı listeden geliyor)',
      yalniz(kapiSorunlari(dogruYol, locres, en, indeks.eslesme, ceviri, []), /değer Türkçe\[kimlik\] ile farklı/));
    dene('çıkış kapısı (başlık): 6. parametre (liste) verilmezse ya da dizi değilse hata fırlatır (unutulan parametre kuralı sessizce kapatmasın)',
      firlatir(() => kapiSorunlari(dogruYol, locres, en, indeks.eslesme, ceviri), /başlık listesi verilmeli/) &&
      firlatir(() => kapiSorunlari(dogruYol, locres, en, indeks.eslesme, ceviri, null), /başlık listesi verilmeli/));
    // Gerçek veride aynı anahtarı iki ad alanında taşıyan giriş yok: kapının ad alanı ayrımı yalnız bu sentetik dörtlüyle görünür (b1: N/a İ'li).
    const kosSent = (girisler, liste) => {
      const b = trLocresBayt(girisler); const y = join(gecici, `sent-kapi-${++kapiNo}_P.pak`); writeFileSync(y, yamaPakKur(b));
      return kapiSorunlari(y, b, bEn, bEsl, { 1: 'Yeni {k_i} Oyun' }, liste);
    };
    dene('çıkış kapısı sentetik (başlık): aynı kimlik ve aynı anahtar iki ad alanında; yalnız listedeki N/a İ\'li ise sorunsuz (M/a ad alanı farklı, doğal olmalı)',
      kosSent(b1.girisler, [['N', 'a']]).length === 0);
    dene('çıkış kapısı sentetik (başlık): ad alanı farklı M/a da İ\'li yazılmışsa yakalanıyor (kapı listeyi ad alanıyla birlikte arıyor)',
      yalniz(kosSent(bKur({ baslik: [['N', 'a'], ['M', 'a']] }).girisler, [['N', 'a']]), /değer Türkçe\[kimlik\] ile farklı/));

    // G5: gerçek veri. Beklenen sayılar çeviriden BAĞIMSIZ hesaplanır (üreticinin kendi sayacıyla kendini onaylamasın).
    const beklenenDegisen = baslik.filter(([ns, key]) => /i/.test(cevirisi(en.girisler.findIndex(e => e.ns === ns && e.key === key)).replace(ytHepsi, ''))).length;
    const degisenGirisler = geri.girisler.filter((t, i) => t.deger !== cevirisi(i));
    dene(`başlık gerçek: değişen giriş sayısı (${degisenGirisler.length}) = çevirisinde yer tutucu dışında i olan listedeki anahtar sayısı = tr.sayilar.baslikDegisen; değişenlerin hepsi listeden`,
      beklenenDegisen >= 1 && degisenGirisler.length === beklenenDegisen && tr.sayilar.baslikDegisen === beklenenDegisen &&
      geri.girisler.every((t, i) => t.deger === cevirisi(i) || baslikMi(en.girisler[i])));
    const yeniOyun = Object.keys(kaynakEn).filter(k => kaynakEn[k] === 'New Game');
    const yeniGirisler = indeks.eslesme.map((e, i) => i).filter(i => yeniOyun.includes(String(indeks.eslesme[i][3])));
    dene(`başlık gerçek: "New Game" (${yeniGirisler.length} giriş) listede ve değeri çevirisinin yalnız i'leri İ yapılmış hâli ("Yeni Oyun" → "Yenİ Oyun")`,
      yeniGirisler.length >= 1 && yeniGirisler.every(i => baslikMi(en.girisler[i]) && geri.girisler[i].deger !== cevirisi(i) && geri.girisler[i].deger === cevirisi(i).replace(/i/g, 'İ')));
    const ytGirisleri = geri.girisler.map((t, i) => [t, cevirisi(i), i]).filter(([, c, i]) => baslikMi(en.girisler[i]) && ytVar.test(c));
    dene(`başlık gerçek: listedeki yer tutuculu ya da etiketli giriş ${ytGirisleri.length} tane (en az 1), yer tutucuları çeviriyle aynen aynı, en az biri gerçekten dönüştü`,
      ytGirisleri.length >= 1 && ytGirisleri.every(([t, c]) => JSON.stringify(t.deger.match(ytHepsi)) === JSON.stringify(c.match(ytHepsi))) && ytGirisleri.some(([t, c]) => t.deger !== c));
    const kimlikGirisleri = new Map();
    indeks.eslesme.forEach((e, i) => { if (e[3] !== 0) kimlikGirisleri.set(e[3], [...(kimlikGirisleri.get(e[3]) ?? []), i]); });
    const ortak = [...kimlikGirisleri].filter(([, l]) => l.some(i => baslikMi(en.girisler[i])) && l.some(i => !baslikMi(en.girisler[i])));
    const ortakI = ortak.filter(([id]) => /i/.test(ceviri[String(id)].replace(ytHepsi, '')));
    dene(`başlık gerçek: aynı çeviri kimliğini hem başlık hem gövde anahtarı paylaşan ${ortak.length} kimlik var, çevirisinde i olan ${ortakI.length} (en az 1): listedeki girişler İ'li, listede olmayanlar çeviriyle AYNI`,
      ortakI.length >= 1 && ortakI.every(([id, l]) => l.every(i => baslikMi(en.girisler[i]) ? geri.girisler[i].deger !== ceviri[String(id)] : geri.girisler[i].deger === ceviri[String(id)])));

    // ---------------- H: dil listesi varlığı ("Türkçe" etiketi, 13.11.2026): `tools/lib/dil-varligi.mjs`, `yamaPakKur` ek dosyaları, kapının dil dalı.
    // Beklenen baytlar kitaplık kodundan BAĞIMSIZ: oyunun gerçek varlığında elle çözülen satır (docs/oyun-haritasi.md "Menüde göster"),
    // ekleme noktası ve üç boyut alanı burada sabit. Ad indeksleri (22, 20, 12, 23, 15) bu build'in varlığına özgü: build değişirse bu blok
    // BAŞARISIZ olur ve yeniden ölçülmesi gerekir (kasten: sessiz geçmesin).
    const hUa = oyunDilVarligi(paketler).uasset, hUe = oyunDilVarligi(paketler).uexp;
    const hUaKopya = Buffer.from(hUa), hUeKopya = Buffer.from(hUe);
    const hEsitMi = (a, b) => { try { deepStrictEqual(a, b); return true; } catch { return false; } };
    const hSadece = (sorunlar, desen) => sorunlar.length === 1 && desen.test(sorunlar[0]);
    const hOzgunSatirlar = hataNull(() => dilSatirlari(hUa, hUe));
    dene('dil gerçek: oyunun özgün dil listesi 8 satır (en de es fr ru zh ja ko), "tr" yok, hepsi ST_UserInterface tablosundan Settings_Language_* anahtarı',
      !!hOzgunSatirlar && hOzgunSatirlar.map(s => s.etiket).join(' ') === 'en de es fr ru zh ja ko' &&
      hOzgunSatirlar.every(s => s.ad.tur === 'tablo' && /ST_UserInterface$/.test(s.ad.tablo) && /^Settings_Language_/.test(s.ad.anahtar)));
    dene('dil gerçek: oyunDilVarligi paket listesinde varlık yoksa hata veriyor (sessiz geçmez, pak etiketsiz üretilmez)', firlatir(() => oyunDilVarligi([]), /dil listesi varlığı bulunamadı/));
    const H_BULK = 169;   // uasset'te BulkDataStartOffset (int64); bu varlıkta 2161 = başlık 1172 + SerialSize 989
    const h989 = []; for (let i = 0; i + 8 <= hUa.length; i++) if (hUa.readBigInt64LE(i) === 989n) h989.push(i);
    dene('dil gerçek: alan yerleri bu varlıkta (uexp 16 = 915, 33 = 8, 53 = 862; uasset 169 = int64 2161; int64 989 tek yerde) — beklenen-bayt ve bozma sınamaları bunlara dayanır',
      hUe.readInt32LE(16) === 915 && hUe.readInt32LE(33) === 8 && hUe.readInt32LE(53) === 862 && hUa.readBigInt64LE(H_BULK) === 2161n && h989.length === 1);
    const H_SERIAL = h989[0];
    const H_SATIR = Buffer.from(('16000000 00000000 14000000 00000000 07000000 00000000 00 03000000 7472 00 | ' +
      '0c000000 00000000 17000000 00000000 1b000000 00000000 00 02000000 ff 01000000 f9ffffff 5400fc00 72006b00 e7006500 0000 | ' +
      '0f000000 00000000').replace(/[\s|]/g, ''), 'hex');
    const H_EKLEME = 33 + 915;   // dizinin son baytından sonrası (özellik değeri 33'te başlar, 915 bayt); orada NativeClass başlıyor
    const hBekUexp = Buffer.concat([hUe.subarray(0, H_EKLEME), H_SATIR, hUe.subarray(H_EKLEME)]);
    hBekUexp.writeInt32LE(915 + H_SATIR.length, 16); hBekUexp.writeInt32LE(9, 33); hBekUexp.writeInt32LE(862 + H_SATIR.length, 53);
    const hEk = hataNull(() => dilVarligiEkDosyalari(hUa, hUe));
    dene('dil gerçek: satır 92 bayt; yeni uexp = özgün uexp + elle çözülen satır baytları + üç boyut alanı (915 → 1007, 8 → 9, 862 → 954), bayt bayt eşit',
      H_SATIR.length === 92 && !!hEk && hEk[1].veri.equals(hBekUexp));
    const hUaFark = []; if (hEk && hEk[0].veri.length === hUa.length) for (let i = 0; i < hUa.length; i++) if (hUa[i] !== hEk[0].veri[i]) hUaFark.push(i);
    dene('dil gerçek: yeni uasset aynı boyda; yalnız iki alan değişti: SerialSize (989 → 1081) ve BulkDataStartOffset (2161 → 2253), başka bayt aynı',
      !!hEk && hEk[0].veri.length === hUa.length && hEk[0].veri.readBigInt64LE(H_SERIAL) === 1081n && hEk[0].veri.readBigInt64LE(H_BULK) === 2253n &&
      hUaFark.length > 0 && hUaFark.every(i => (i >= H_SERIAL && i < H_SERIAL + 8) || (i >= H_BULK && i < H_BULK + 8)));
    const hYeniSatirlar = hEk ? hataNull(() => dilSatirlari(hEk[0].veri, hEk[1].veri)) : null;
    dene('dil gerçek: eklenince 9 satır; ilk 8 satır özgünle aynı, son satır { tr, değişmez metin "Türkçe", bayrak 2 }',
      !!hYeniSatirlar && !!hOzgunSatirlar && hYeniSatirlar.length === 9 && hEsitMi(hYeniSatirlar.slice(0, 8), hOzgunSatirlar) &&
      hEsitMi(hYeniSatirlar[8], { etiket: 'tr', ad: { tur: 'degismez', metin: 'Türkçe', bayrak: 2 } }));
    dene('dil hata: yamalı varlığa ikinci kez tr eklemek reddediliyor', !!hEk && firlatir(() => dilVarligiEkDosyalari(hEk[0].veri, hEk[1].veri), /"tr" etiketi listede zaten var/));
    dene('dil hata: boş etiket ve boş ad reddediliyor', firlatir(() => dilSatiriEkle(hUa, hUe, { etiket: '', ad: 'x' }), /etiket ve ad dolu metin/) && firlatir(() => dilSatiriEkle(hUa, hUe, { etiket: 'x', ad: '' }), /etiket ve ad dolu metin/));
    const hDegistir = (b, f) => { const c = Buffer.from(b); f(c); return c; };
    const hBozDene = (ad, ua, ue) => dene(`dil hata: ${ad} reddediliyor`, firlatir(() => dilVarligiEkDosyalari(ua, ue), /dil varlığı/));
    hBozDene('uexp dizi boyut alanı +1 (16)', hUa, hDegistir(hUe, c => c.writeInt32LE(916, 16)));
    hBozDene('uexp eleman sayısı +1, satır yok (33: 8 → 9)', hUa, hDegistir(hUe, c => c.writeInt32LE(9, 33)));
    hBozDene('uexp iç etiket boyutu +1 (53)', hUa, hDegistir(hUe, c => c.writeInt32LE(863, 53)));
    hBozDene('uasset SerialSize +1', hDegistir(hUa, c => c.writeBigInt64LE(990n, H_SERIAL)), hUe);
    hBozDene('uasset BulkDataStartOffset +1 (adayı kalmıyor)', hDegistir(hUa, c => c.writeBigInt64LE(2162n, H_BULK)), hUe);
    hBozDene('uexp bir bayt kısa', hUa, hUe.subarray(0, hUe.length - 1));
    hBozDene('uasset bir bayt kısa', hUa.subarray(0, hUa.length - 1), hUe);
    hBozDene('uexp ilk özellik adı Names değil (ad indeksi 0)', hUa, hDegistir(hUe, c => c.writeInt32LE(0, 0)));
    hBozDene('uasset paket etiketi bozuk (ilk bayt)', hDegistir(hUa, c => { c[0] ^= 0xFF; }), hUe);

    // kapının dil dalı (üretici gerçek): doğru pak sorunsuz, bozuk paklar yakalanıyor
    const hU = uretVeDogrula(en, join(gecici, 'h'), { uasset: hUa, uexp: hUe });
    const hPk = pakAc(hU.yol); acilanlar.push(hPk);
    const hYollar = hPk.liste().map(x => x.yol).sort();
    dene('dil üretici: uretVeDogrula(dilOzgun) pakı 3 dosyalı (locres + uasset + uexp), çıkış kapısı sorunsuz',
      hU.sorun.length === 0 && hEsitMi(hYollar, [YAMA_DIL_UASSET_YOLU, YAMA_DIL_UEXP_YOLU, YAMA_LOCRES_YOLU].sort()));
    const hDil = hEk ? { ozgunUasset: hUa, ozgunUexp: hUe, uasset: hEk[0].veri, uexp: hEk[1].veri } : null;
    const hLoc = { yol: YAMA_LOCRES_YOLU, veri: hU.locres };
    const hA = hEk ? { yol: YAMA_DIL_UASSET_YOLU, veri: hEk[0].veri } : null, hE = hEk ? { yol: YAMA_DIL_UEXP_YOLU, veri: hEk[1].veri } : null;
    let hNo = 0;
    const hKapi = (dosyalar, dil = hDil) => { const y = join(gecici, `h-kapi-${++hNo}_P.pak`); writeFileSync(y, pakYaz({ dosyalar })); return kapiSorunlari(y, hU.locres, en, indeks.eslesme, ceviri, baslik, dil); };
    dene('dil kapı: doğru 3 dosyalı pak sorunsuz; dosyalar yola göre eşleniyor (pakta sıra ters yazılsa da)', !!hDil && hKapi([hLoc, hA, hE]).length === 0 && hKapi([hE, hA, hLoc]).length === 0);
    dene('dil kapı karşı test: tek dosyalı pak (dil varlığı yok) dilVarligi verilince yakalanıyor', !!hDil && hSadece(hKapi([hLoc]), /pakta 1 dosya var, 3 bekleniyordu/));
    dene('dil kapı karşı test: dilVarligi null iken 3 dosyalı pak yakalanıyor (eski tek dosyalı beklenti)', !!hDil && hSadece(hKapi([hLoc, hA, hE], null), /pakta 3 dosya var, 1 bekleniyordu/));
    dene('dil kapı karşı test: uexp yerine başka yolda dosya olan 3 dosyalı pak yakalanıyor', !!hDil &&
      hSadece(hKapi([hLoc, hA, { yol: 'ModernStoryteller01/Content/0Game/Baska.uexp', veri: hE.veri }]), /pakın yolu beklenenle uyuşmuyor: ".*LanguageTagToNames\.uexp" yok/));
    const hUeBozuk = hE ? hDegistir(hE.veri, c => { c[c.indexOf(Buffer.from('Türkçe', 'utf16le'))] = 0x74; }) : null;   // "Türkçe" → "türkçe"
    const hBozukSonuc = hDil ? hKapi([hLoc, hA, { yol: YAMA_DIL_UEXP_YOLU, veri: hUeBozuk }]) : [];
    dene('dil kapı karşı test: yeni satırda tek harf farkı (Türkçe → türkçe; ayrıştırılabilir ama içerik farklı) iki iletiyle yakalanıyor: bayt farkı + dil listesi farkı',
      hBozukSonuc.length === 2 && /uexp baytları kurulan ile aynı değil/.test(hBozukSonuc[0]) && /paktaki dil listesi "özgün 8 satır \+ tr" değil/.test(hBozukSonuc[1]));
    dene('dil kapı karşı test: baytlar kurulanla eşit ama özgün olarak yamalı varlık verilmişse (beklenen 9 + tr ≠ gelen 9) yalnız dil listesi iletisiyle yakalanıyor',
      !!hDil && hSadece(hKapi([hLoc, hA, hE], { ...hDil, ozgunUasset: hA.veri, ozgunUexp: hE.veri }), /paktaki dil listesi "özgün 9 satır \+ tr" değil/));
    dene('dil kapı: dilVarligi eksik alanlıysa kapı hata veriyor (sessiz geçmez)', firlatir(() => kapiSorunlari(hU.yol, hU.locres, en, indeks.eslesme, ceviri, baslik, { uasset: hUa }), /dilVarligi/));
    dene('dil: kitaplık girdi Buffer\'larına dokunmuyor (özgün uasset ve uexp H bloğu boyunca aynı)', hUa.equals(hUaKopya) && hUe.equals(hUeKopya));
    // ---------------- I: başlık yazı tipi yaması (18.11.2026): `tools/lib/yazi-tipi-yama.mjs`, 4. pak dosyası, kapının yazı tipi dalı.
    // Beklenenler kitaplık kodundan bağımsız elle yazılı: i (U+0069) → özgün İ (U+0130) glifi; I, ı, İ ve öteki her kod noktası aynı;
    // cmap ve head dışındaki her sfnt tablosu bayt bayt aynı. Bu blok şunu ölçmez: motorun yamalı yazı tipini yükleyip kullandığı.
    const iOz = oyunYaziTipi(paketler);
    const iOzKopya = Buffer.from(iOz);
    const iYm = hataNull(() => yaziTipiEkDosyasi(iOz));
    const iOkuO = cmapOku(iOz), iOkuY = iYm ? cmapOku(iYm[0].veri) : null;
    dene('yazı tipi: yama yolu oyunun yazı tipi yoluyla aynı, özgün 390 KB civarı OTF', !!iYm && iYm[0].yol === YAMA_YAZI_TIPI_YOLU && iOz.toString('latin1', 0, 4) === 'OTTO');
    dene('yazı tipi: i (U+0069) özgün i ve İ glifinden FARKLI yeni bir glife bağlandı (özgün i ve İ glifleri yerinde)', !!iOkuY && iOkuY.glif(0x69) !== iOkuO.glif(0x69) && iOkuY.glif(0x69) !== iOkuO.glif(0x130) && iOkuY.glif(0x69) !== 0);
    dene('yazı tipi: yeni glif doğru: gövde = özgün i, nokta = özgün İ noktası (aynı boy, ortalı, aynı aralık), başka glif değişmedi', !!iYm && hEsitMi(yaziTipiSorunlari(iOz, iYm[0].veri), []));
    dene('yazı tipi: I (U+0049), ı (U+0131), İ (U+0130) glifleri değişmedi', !!iOkuY && [0x49, 0x131, 0x130].every(k => iOkuY.glif(k) === iOkuO.glif(k)));
    let iDegisen = -1; if (iOkuY) { iDegisen = 0; for (let k = 0; k <= 0xFFFF; k++) if (k !== 0x69 && iOkuO.glif(k) !== iOkuY.glif(k)) iDegisen++; }
    dene('yazı tipi: i dışında HİÇBİR kod noktasının glifi değişmedi (65.535 kod noktası)', iDegisen === 0);
    const iTablolar = (b) => { const m = new Map(); for (let t = 0; t < b.readUInt16BE(4); t++) { const o = 12 + t * 16; m.set(b.toString('latin1', o, o + 4), b.subarray(b.readUInt32BE(o + 8), b.readUInt32BE(o + 8) + b.readUInt32BE(o + 12))); } return m; };
    const iTO = iTablolar(iOz), iTY = iYm ? iTablolar(iYm[0].veri) : new Map();
    dene('yazı tipi: cmap, head ve CFF dışındaki her sfnt tablosu (GPOS, GSUB, kern, hmtx…) bayt bayt aynı, tablo adları aynı',
      !!iYm && [...iTO.keys()].join() === [...iTY.keys()].join() && [...iTO.entries()].every(([ad, v]) => ad === 'cmap' || ad === 'head' || ad === 'CFF ' || (iTY.get(ad)?.equals(v))));
    dene('yazı tipi: yamalı yazı tipine ikinci kez yama reddediliyor', !!iYm && firlatir(() => iNoktaliYap(iYm[0].veri), /zaten yamalı/));
    dene('yazı tipi: cmap tablosu olmayan baytlar reddediliyor (sessiz geçmez)', firlatir(() => iNoktaliYap(Buffer.alloc(64)), /tablo yok: cmap|zaten|yok/));
    dene('yazı tipi: kitaplık girdi Buffer\'ına dokunmuyor', iOz.equals(iOzKopya));
    const iU = uretVeDogrula(en, join(gecici, 'i'), { uasset: hUa, uexp: hUe }, iOz);
    const iPk = pakAc(iU.yol); acilanlar.push(iPk);
    const iYollar = iPk.liste().map(g => g.yol).sort();
    dene('yazı tipi üretici: uretVeDogrula pakı 4 dosyalı (locres + uasset + uexp + ufont), çıkış kapısı sorunsuz',
      iU.sorun.length === 0 && hEsitMi(iYollar, [YAMA_DIL_UASSET_YOLU, YAMA_DIL_UEXP_YOLU, YAMA_LOCRES_YOLU, YAMA_YAZI_TIPI_YOLU].sort()));
    const iYazi = iYm ? { ozgun: iOz, yama: iYm[0].veri } : null;
    const iDosya = iYm ? { yol: YAMA_YAZI_TIPI_YOLU, veri: iYm[0].veri } : null;
    let iNo = 0;
    const iKapi = (dosyalar, yazi = iYazi) => { const y = join(gecici, `i-kapi-${++iNo}_P.pak`); writeFileSync(y, pakYaz({ dosyalar })); return kapiSorunlari(y, hU.locres, en, indeks.eslesme, ceviri, baslik, hDil, yazi); };
    dene('yazı tipi kapı: doğru 4 dosyalı pak sorunsuz; dosyalar yola göre eşleniyor (sıra ters yazılsa da)', !!iYm && iKapi([hLoc, hA, hE, iDosya]).length === 0 && iKapi([iDosya, hE, hA, hLoc]).length === 0);
    dene('yazı tipi kapı karşı test: yazı tipsiz 3 dosyalı pak yaziTipi verilince yakalanıyor', !!iYm && hSadece(iKapi([hLoc, hA, hE]), /pakta 3 dosya var, 4 bekleniyordu/));
    dene('yazı tipi kapı karşı test: yaziTipi null iken 4 dosyalı pak yakalanıyor', !!iYm && hSadece(iKapi([hLoc, hA, hE, iDosya], null), /pakta 4 dosya var, 3 bekleniyordu/));
    dene('yazı tipi kapı karşı test: yazı tipi başka yolda ise yakalanıyor', !!iYm &&
      hSadece(iKapi([hLoc, hA, hE, { yol: 'ModernStoryteller01/Content/0Game/UI/Fonts/baska.ufont', veri: iDosya.veri }]), /pakın yolu beklenenle uyuşmuyor: ".*goudytrajan-bold-pro\.ufont" yok/));
    const iYamasiz = iKapi([hLoc, hA, hE, { yol: YAMA_YAZI_TIPI_YOLU, veri: iOz }]);
    dene('yazı tipi kapı karşı test: YAMASIZ özgün yazı tipi pakta ise iki iletiyle yakalanıyor (bayt farkı + i kısa boy İ glifine bağlı değil)',
      iYamasiz.length === 2 && /yazı tipi baytları kurulan ile aynı değil/.test(iYamasiz[0]) && /i \(U\+0069\) kısa boy İ glifine bağlı değil/.test(iYamasiz[1]));
    // i dışında bir harf kaydırılmış yama: 'A' segmentinin idDelta'sını 1 artır (segment 0 = U+0020-U+0068, delta -31 → -30)
    const iBozuk = iYm ? hDegistir(iYm[0].veri, c => {
      let cm = -1; for (let t = 0; t < c.readUInt16BE(4); t++) if (c.toString('latin1', 12 + t * 16, 16 + t * 16) === 'cmap') cm = c.readUInt32BE(12 + t * 16 + 8);
      const t4 = cm + 532, sc = c.readUInt16BE(t4 + 6) / 2, dOf = t4 + 14 + 2 * sc + 2 + 2 * sc;
      c.writeInt16BE(c.readInt16BE(dOf) + 1, dOf);
    }) : null;
    const iBozukSonuc = iYm ? iKapi([hLoc, hA, hE, { yol: YAMA_YAZI_TIPI_YOLU, veri: iBozuk }], { ozgun: iOz, yama: iBozuk }) : [];
    dene('yazı tipi kapı karşı test: i dışında bir harfin glifi kaymışsa (baytlar kurulanla eşit olsa bile) yakalanıyor',
      iBozukSonuc.length === 1 && /i dışında \d+ kod noktasının glifi değişmiş/.test(iBozukSonuc[0]));
    dene('yazı tipi kapı: yaziTipi eksik alanlıysa kapı hata veriyor (sessiz geçmez)', firlatir(() => kapiSorunlari(hU.yol, hU.locres, en, indeks.eslesme, ceviri, baslik, hDil, { ozgun: iOz }), /yaziTipi/));
  } finally {
    for (const p of acilanlar) { try { p.kapat(); } catch { /* zaten kapalı */ } }
    rmSync(gecici, { recursive: true, force: true });
  }
  console.log(basarisiz ? `\n${basarisiz} sınama başarısız` : '\nhepsi tamam');
  process.exit(basarisiz ? 1 : 0);
}

try {
  if (arg.includes('--sina')) sina(); else uret();
} catch (e) {
  console.error(`ÖLÇÜM BAŞARISIZ: ${e.message}${sonSinama ? ` · hata, şu sınamadan SONRA fırlatıldı: "${sonSinama}"` : arg.includes('--sina') ? ' · hata, HİÇBİR sınama tamamlanmadan fırlatıldı (ilk sınamadan önceki kurulum)' : ''}`);
  process.exit(1);
}
