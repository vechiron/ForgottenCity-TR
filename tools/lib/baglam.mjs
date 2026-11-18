// Çeviri bağlamı: locres girişlerini geçtikleri varlığa göre gruplar ve parçalar. YALNIZCA OKUR.
// Neden: locres'in kendi sırası alfabetik (bağlam yok); anahtarları geçtikleri varlığa göre gruplayınca konuşmalar
// sırasıyla (konuşmacı adı ve repliği) çıkıyor. Ajanlara bağlamı korunmuş parça verilir.
//
// Bu ölçüm şunu GÖREMEZ: bir replik hangi karaktere ait (konuşmacı adı ayrı bir giriş olarak sırayla gelir, ilişki
// çıkarımdır) · konuşma ağacındaki dallanma sırası (dosya sırası = oyun sırası olmayabilir) · locres'e girip varlıkta
// bulunamayan girişlerin bağlamı (ayrı gruba konur, bağlamsızdır) · aynı metnin başka bir bağlamda başka çevrilmesi
// gerektiği (aynı İngilizce metin tek kez, ilk görüldüğü grupta çevrilir).
import { tamYol } from './atif.mjs';
import { adTablosu, ftextler } from './uexp-metin.mjs';

const KOK = 'ModernStoryteller01/Content/';
export const YERI_BILINMEYEN = '(yeri bilinmeyen)';

/**
 * hepsi: [{ pk, g }] · Döner: { konum: Map(anahtar → { rel, o } en küçük (rel, o)), varlik, adHatalari: [{ rel, mesaj }] }
 * Birden çok yerde geçen anahtarda deterministik seçim için en küçük (rel, sonra o) alınır.
 */
export function anahtarKonumlari(hepsi) {
  const giris = new Map();
  for (const { pk, g } of hepsi) giris.set(tamYol(pk, g), { pk, g });
  const konum = new Map(), adHatalari = [];
  let varlik = 0;
  for (const [yol, e] of giris) {
    if (!yol.startsWith(KOK) || !/\.(uasset|umap)$/.test(yol)) continue;
    const u = e.pk.icerik(e.g);
    if (!u.includes('TextProperty')) continue;
    const ue = giris.get(yol.replace(/\.(uasset|umap)$/, '.uexp'));
    if (!ue) continue;
    const rel = yol.slice(KOK.length).replace(/\.(uasset|umap)$/, '');
    let adlar;
    try { adlar = adTablosu(u); } catch (x) { adHatalari.push({ rel, mesaj: x.message }); continue; }
    varlik++;
    for (const r of ftextler(adlar, ue.pk.icerik(ue.g)).kayit) {
      if (r.tur !== 0 || !r.key) continue;
      const onceki = konum.get(r.key);
      if (!onceki || rel < onceki.rel || (rel === onceki.rel && r.o < onceki.o)) konum.set(r.key, { rel, o: r.o });
    }
  }
  return { konum, varlik, adHatalari };
}

/**
 * girisler: locresCoz().girisler · konum: anahtarKonumlari().konum
 * Döner: { gruplar: [{ ad, metinler: [{ id, en }] }], eslesme: [{ ns, key, kaynakHash, id }], bos, yeriBilinmeyen }
 *   - boş ("") metin çevrilmez; eslesme'de id 0.
 *   - aynı İngilizce metin TEK kez (ilk görüldüğü grupta) ve tek id alır; eslesme her girişi o id'ye bağlar.
 *   - gruplar ada göre sıralı (aynı klasör, yani aynı karakterin konuşmaları yan yana), yeri bilinmeyenler en sonda;
 *     grup içi sıra dosya sırası, yeri bilinmeyende locres sırası. id'ler bu sırayla 1'den artar.
 */
export function metinGruplari(girisler, konum) {
  const gruplar = new Map();
  girisler.forEach((x, i) => {
    if (x.deger === '') return;
    const k = konum.get(x.key);
    const ad = k ? k.rel : (x.ns ? `(ad alanı: ${x.ns})` : YERI_BILINMEYEN);
    const g = gruplar.get(ad) ?? gruplar.set(ad, []).get(ad);
    g.push({ x, sira: k ? k.o : i });
  });
  const bilinen = [...gruplar.keys()].filter(a => !a.startsWith('(')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const bilinmeyen = [...gruplar.keys()].filter(a => a.startsWith('(')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const idler = new Map();             // İngilizce metin → id
  const sonuc = [];
  let id = 0, yeriBilinmeyen = 0;
  for (const ad of [...bilinen, ...bilinmeyen]) {
    const metinler = [];
    for (const { x } of gruplar.get(ad).sort((a, b) => a.sira - b.sira)) {
      if (idler.has(x.deger)) continue;
      idler.set(x.deger, ++id);
      metinler.push({ id, en: x.deger });
      if (ad.startsWith('(')) yeriBilinmeyen++;
    }
    if (metinler.length) sonuc.push({ ad, metinler });
  }
  const eslesme = girisler.map(x => ({ ns: x.ns, key: x.key, kaynakHash: x.kaynakHash, id: x.deger === '' ? 0 : idler.get(x.deger) }));
  return { gruplar: sonuc, eslesme, bos: girisler.filter(x => x.deger === '').length, yeriBilinmeyen };
}

const boyut = (g) => g.metinler.reduce((t, m) => t + m.en.length, 0);

/**
 * Grupları parçalara böler. Parça sınırı GRUP sınırıdır (bir konuşma ikiye bölünmez); tek başına hedefi aşan grup
 * zorunlu olarak metin sınırından bölünür ve devam parçasında grup adı "(devam)" ile gelir.
 * hedef: parça başına en çok karakter (grup sınırında aşmaz; yalnızca tek grup hedefi aşarsa bölünür).
 */
export function parcala(gruplar, hedef) {
  const parcalar = [];
  let simdiki = { gruplar: [], karakter: 0 };
  const kapat = () => { if (simdiki.gruplar.length) parcalar.push(simdiki); simdiki = { gruplar: [], karakter: 0 }; };
  for (const g of gruplar) {
    const b = boyut(g);
    if (b > hedef) {                                   // tek başına hedefi aşıyor: önce açığı kapat, metin sınırından böl
      kapat();
      let kisim = { ad: g.ad, metinler: [] }, kb = 0;
      for (const m of g.metinler) {
        if (kb + m.en.length > hedef && kisim.metinler.length) {
          parcalar.push({ gruplar: [kisim], karakter: kb });
          kisim = { ad: `${g.ad} (devam)`, metinler: [] }; kb = 0;
        }
        kisim.metinler.push(m); kb += m.en.length;
      }
      if (kisim.metinler.length) parcalar.push({ gruplar: [kisim], karakter: kb });
      continue;
    }
    if (simdiki.karakter + b > hedef) kapat();
    simdiki.gruplar.push(g); simdiki.karakter += b;
  }
  kapat();
  return parcalar;
}
