// "Locres dışı metin" ölçümü: uasset/uexp içindeki FText kayıtlarını (okuyucu: lib/uexp-metin.mjs) locres'e göre
// sınıflar. YALNIZCA OKUR. Sayılar belgeye yazılmaz; tools/oyun-haritasi.mjs her koşumda buradan basar.
//
// Bu ölçüm şunu GÖREMEZ: bir kaydın oyunda oyuncuya gösterilip gösterilmediğini (yalnız "locres'e girer mi" sorusu
// ölçülür) · okuyucunun kaçırdıklarını (lib/uexp-metin.mjs'nin başındaki liste) · .umap'te .uexp'i olmayan haritaları.
import { tamYol } from './atif.mjs';
import { adTablosu, ftextler, sezgiselAdaylar } from './uexp-metin.mjs';

export const KOK = 'ModernStoryteller01/Content/';
export const TEST_SEVIYESI = '0Game/Levels/Testing/';

/** Durum kodu → okunur ad. Sıra, basılan sıradır. */
export const DURUMLAR = {
  'base-locres': "Base · ad alanı+anahtar locres'te",
  'base-yalniz-anahtar': "Base · yalnız anahtar locres'te (ad alanı farklı)",
  'base-yok': "Base · anahtarı locres'te YOK",
  'base-anahtarsiz': 'Base · anahtarsız',
  'none-degismez': 'None · değişmez metin (FromString; anahtarsız, locres\'e girmez)',
  'none-bos': 'None · boş',
  'tablo': 'StringTable girişi',
  'cozulmedi': 'başka geçmiş türü (çözülmedi)',
};

/** Tek FText kaydının durum kodu. kume: { nsAnahtar: Set('ns\0anahtar'), anahtar: Set }. */
export function sinifla(r, kume) {
  if (r.tur === 0) {
    if (r.key === '') return 'base-anahtarsiz';
    if (kume.nsAnahtar.has(`${r.ns}\0${r.key}`)) return 'base-locres';
    return kume.anahtar.has(r.key) ? 'base-yalniz-anahtar' : 'base-yok';
  }
  if (r.tur === -1) return r.degismez ? 'none-degismez' : 'none-bos';
  if (r.tur === 11) return 'tablo';
  return 'cozulmedi';
}

const klasorAdi = (rel) => rel.split('/').slice(0, 2).join('/');
const grupAdi = (rel) => (rel.startsWith('0Game/') ? 'oyun' : 'eklenti');
const say = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

/**
 * hepsi: [{ pk, g }] (bütün paketlerin girişleri) · en: locresCoz(İngilizce Game.locres) sonucu.
 * Döner: { varlik, adHatalari[], sayac, durum (Map 'grup|kod'→n), klasorlu (Map 'kod|klasör'→n), ornek (Map 'grup|kod'→[]),
 *   testteYok (oyunda anahtarı locres'te olmayan Base'lerden Levels/Testing altındakiler), tabloAdlari (Map), tabloAnahtarla,
 *   tabloToplam, sezgiselFazla[], sezgiselKacirdi[], anahtarToplam, anahtarBulunan }.
 */
export function locresDisiOlc(hepsi, en) {
  const kume = {
    nsAnahtar: new Set(en.girisler.map(x => `${x.ns}\0${x.key}`)),
    anahtar: new Set(en.girisler.map(x => x.key)),
  };
  const giris = hepsi.map(({ pk, g }) => ({ pk, g, yol: tamYol(pk, g) }));
  const yolHaritasi = new Map(giris.map(e => [e.yol, e]));
  const o = {
    varlik: 0, adHatalari: [], sayac: { tek: 0, dizi: 0, diziElemani: 0, boyutTutmayan: 0, diziCozulmeyen: 0 },
    durum: new Map(), klasorlu: new Map(), ornek: new Map(), testteYok: 0,
    tabloAdlari: new Map(), tabloAnahtarla: 0, tabloToplam: 0, sezgiselFazla: [], sezgiselKacirdi: [],
    anahtarToplam: kume.anahtar.size, anahtarBulunan: 0,
  };
  const bulunan = new Set();

  for (const e of giris) {
    if (!e.yol.startsWith(KOK) || !/\.(uasset|umap)$/.test(e.yol)) continue;
    const u = e.pk.icerik(e.g);
    if (!u.includes('TextProperty')) continue;
    const ue = yolHaritasi.get(e.yol.replace(/\.(uasset|umap)$/, '.uexp'));
    if (!ue) continue;
    const rel = e.yol.slice(KOK.length).replace(/\.(uasset|umap)$/, '');
    let adlar;
    try { adlar = adTablosu(u); } catch (x) { o.adHatalari.push({ rel, mesaj: x.message }); continue; }
    o.varlik++;
    const b = ue.pk.icerik(ue.g);
    const { kayit, sayac } = ftextler(adlar, b);
    for (const k of Object.keys(sayac)) o.sayac[k] += sayac[k];
    const grup = grupAdi(rel), kl = klasorAdi(rel);
    for (const r of kayit) {
      const kod = sinifla(r, kume);
      say(o.durum, `${grup}|${kod}`); say(o.klasorlu, `${kod}|${kl}`);
      if (kod === 'base-locres' || kod === 'base-yalniz-anahtar') bulunan.add(r.key);
      if (kod === 'base-yok' && rel.startsWith(TEST_SEVIYESI)) o.testteYok++;
      if (kod === 'tablo') {
        o.tabloToplam++; say(o.tabloAdlari, r.ns);
        if (kume.anahtar.has(r.key)) o.tabloAnahtarla++;
      }
      const liste = o.ornek.get(`${grup}|${kod}`) ?? o.ornek.set(`${grup}|${kod}`, []).get(`${grup}|${kod}`);
      if (liste.length < 3) liste.push({ rel, ns: r.ns, key: r.key, src: r.src });
    }
    // çapraz doğrulama, iki yön. Sezgiselin o'su tür baytı, etiketlinin o'su değer başı (4 bayt önce).
    // (1) etiket aramadan bulunan anahtarlı kayıt etiketlinin bulduklarında yoksa "fazla"dır
    // (2) etiketlinin bulduğu, sezgiselin görebileceği türden (anahtarı 32 hane, kaynak dolu) kayıt sezgiselde yoksa "kaçırılan"dır
    const etiketliO = new Set(kayit.map(r => r.o));
    const sezgisel = sezgiselAdaylar(b);
    const sezgiselO = new Set(sezgisel.map(r => r.o));
    for (const r of sezgisel) {
      if (r.key === '' || etiketliO.has(r.o - 4)) continue;
      o.sezgiselFazla.push({ rel, key: r.key, src: r.src, locresteMi: kume.anahtar.has(r.key) });
      if (kume.anahtar.has(r.key)) bulunan.add(r.key);
    }
    for (const r of kayit) {
      if (r.tur === 0 && /^[0-9A-F]{32}$/.test(r.key) && r.src.length >= 1 && !sezgiselO.has(r.o + 4)) o.sezgiselKacirdi.push({ rel, key: r.key, src: r.src });
    }
  }
  o.anahtarBulunan = [...kume.anahtar].filter(k => bulunan.has(k)).length;
  return o;
}
