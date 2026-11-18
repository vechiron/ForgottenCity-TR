// Yama çekirdeği (SAF: diske ve oyuna dokunmaz). İngilizce locres + çeviri → Türkçe locres → `_P.pak` içeriği.
// Okuma/yazma ve oyun klasörü işi `tools/yama-uret.mjs`de; burada yalnızca bellekteki veri dönüşümü ve kapılar var.
import { locresYaz } from './locres.mjs';
import { pakYaz } from './pak.mjs';
import { dilSatiriEkle } from './dil-varligi.mjs';
import { iNoktaliYap } from './yazi-tipi-yama.mjs';

/** Yama pakının içindeki yol (oyunun kendi `en/Game.locres` yoluyla aynı, `en` yerine `tr`). */
export const YAMA_LOCRES_YOLU = 'ModernStoryteller01/Content/Localization/Game/tr/Game.locres';
/** Pak adı: UE, adı `_P.pak` ile biten paketi yama sayıp önceliklendirir (UE kaynağından hatırlandı; oyunda ÖLÇÜLMEDİ). */
export const YAMA_PAK_ADI = 'pakchunk0-WindowsNoEditor_P.pak';
/**
 * Ayarlar'daki Dil satırının etiketi: oyunun dil listesi varlığında (`0Game/LanguageTagToNames`) `tr` satırı yok, menü ham "tr" yazıyor
 * (oyunda görüldü, 13.11.2026). Bu satır eklenince "Türkçe" yazması BEKLENİYOR; motorun yamalı varlığı yükleyip göstereceği ÖLÇÜLMEDİ.
 */
export const YAMA_DIL = { etiket: 'tr', ad: 'Türkçe' };
/** Dil listesi varlığının pak içindeki yolları (oyunun `pakchunk0` paketinde ölçüldü: uasset 1172 bayt, uexp 993 bayt). */
export const YAMA_DIL_UASSET_YOLU = 'ModernStoryteller01/Content/0Game/LanguageTagToNames.uasset';
export const YAMA_DIL_UEXP_YOLU = 'ModernStoryteller01/Content/0Game/LanguageTagToNames.uexp';

/**
 * Başlık yazı tipinin (GoudyTrajan) pakteki yolu. Yamalı kopya (cmap'te `i` → `İ` glifi) AYNI yolla pakta konur; böylece sağ panel gibi
 * gövde yazı tipli satırla aynı anahtarı paylaşan başlıklarda da `i` noktalı çizilir. Motorun yamalı yazı tipini yüklediği ÖLÇÜLMEDİ.
 * Lisans: yamalı yazı tipi yalnız kullanıcının bilgisayarında üretilen pakta kalır, depoya girmez.
 */
export const YAMA_YAZI_TIPI_YOLU = 'ModernStoryteller01/Content/0Game/UI/Fonts/goudytrajan-bold-pro.ufont';

const varMi = (nesne, k) => Object.prototype.hasOwnProperty.call(nesne, k);
/** Ad alanı + anahtar tek dizgi (ad alanı da anahtarın parçası: aynı anahtar başka ad alanında başka metindir). */
const anahtarDizgisi = (ns, key) => `${ns}\u0000${key}`;

/**
 * Başlık yazı tipinde (GoudyTrajan) `i` ile `ı` aynı noktasız harftir ("Yeni" → YENI); büyük `İ` ise noktalı çizilir.
 * Bu yüzden başlık anahtarlarında her küçük `i` büyük `İ` yazılır. `ı` ve zaten büyük `İ` dokunulmaz; yer tutucular (`{player}`)
 * ve etiketler (`<b>`, `</>`, `<img id="x"/>`) olduğu gibi kalır (içlerindeki `i` motorun tanıdığı addır, değişirse metin bozulur).
 * İkinci kez uygulanınca aynı sonucu verir. Hangi anahtarların başlık sayıldığı `ceviri/baslik-yazi-tipi.json`da.
 */
export function baslikYazisi(metin) {
  return metin.replace(/(\{[^{}]*\}|<[^<>]*>)|i/g, (eslesen, korunan) => korunan ?? 'İ');
}

/**
 * İngilizce locres girişlerinden Türkçe locres girişlerini kurar. Sıra, ad alanı, anahtar ve üç karma İngilizce'den AYNEN gelir
 * (karma algoritması bilinmiyor, gerekmiyor); yalnız `deger` Türkçe olur.
 * @param {{ en:{girisler:{ns:string,key:string,kaynakHash:number,deger:string,nsHash:number,keyHash:number}[]},
 *           eslesme:[string,string,number,number][],
 *           ceviri:Record<string,string>, kaynakEn?:Record<string,string> }} g
 *   `eslesme`: `ceviri/kaynak/indeks.json`daki [ad alanı, anahtar, kaynakHash, kimlik] (İngilizce giriş sırasıyla; kimlik 0 = boş metin).
 *   `ceviri`: kimlik → Türkçe (parça dosyalarının birleşimi). `kaynakEn`: kimlik → İngilizce (verilirse locres değeriyle karşılaştırılır).
 *   `baslik`: başlık yazı tipiyle çizilen anahtarlar, [ad alanı, anahtar] çiftleri (verilmezse hiçbir anahtara dokunulmaz). Yalnız bu
 *   anahtarların değeri `baslikYazisi`nden geçer; aynı çeviri kimliğini paylaşan öteki anahtarlar (gövde yazı tipli) olduğu gibi kalır.
 * Hata fırlatır (hiçbir sessiz düzeltme yok): eşleşme İngilizce girişlerle tutmuyorsa · kimlik 0 ama İngilizce metin boş değilse ·
 * çeviri eksik ya da boşsa · çeviride hiçbir girişe bağlı olmayan kimlik varsa · `kaynakEn` locres değeriyle tutmuyorsa ·
 * `baslik` çift değilse, aynı anahtarı iki kez içeriyorsa ya da locres'te olmayan anahtar içeriyorsa (build değişmiş).
 * @returns {{girisler:object[], sayilar:{toplam:number, bos:number, cevrilen:number, baslik:number, baslikDegisen:number}}}
 *   `baslik`: listedeki anahtar sayısı; `baslikDegisen`: değeri gerçekten değişen (içinde `i` olan) başlık girişi sayısı.
 */
export function trLocresKur({ en, eslesme, ceviri, kaynakEn, baslik }) {
  const eg = en.girisler;
  if (eslesme.length !== eg.length) throw new Error(`eşleşme ${eslesme.length} giriş, İngilizce locres ${eg.length} giriş: build değişmiş olabilir, "node tools/ceviri-kaynak.mjs" ile yeniden üret`);
  const baslikAdi = new Map();   // dizgi → "ns/anahtar" (hata iletisi için)
  for (const cift of baslik ?? []) {
    if (!Array.isArray(cift) || cift.length !== 2 || typeof cift[0] !== 'string' || typeof cift[1] !== 'string') throw new Error('başlık listesi [ad alanı, anahtar] çiftlerinden oluşmalı');
    const d = anahtarDizgisi(cift[0], cift[1]);
    if (baslikAdi.has(d)) throw new Error(`başlık listesinde ${cift[0]}/${cift[1]} iki kez var`);
    baslikAdi.set(d, `${cift[0]}/${cift[1]}`);
  }
  const baslikBulunan = new Set();
  let baslikDegisen = 0;
  const kullanilan = new Set();
  let bos = 0;
  const girisler = eg.map((e, i) => {
    const [ns, key, kaynakHash, id] = eslesme[i];
    if (ns !== e.ns || key !== e.key || kaynakHash !== e.kaynakHash) throw new Error(`eşleşme ${i}. girişte İngilizce locres ile tutmuyor (${ns}/${key} ↔ ${e.ns}/${e.key})`);
    let deger;
    if (id === 0) {
      if (e.deger !== '') throw new Error(`${ns}/${key}: kimlik 0 (boş metin) ama İngilizce metin boş değil`);
      deger = ''; bos++;
    } else {
      if (!varMi(ceviri, String(id))) throw new Error(`${ns}/${key}: kimlik ${id} için çeviri yok`);
      deger = ceviri[String(id)];
      if (typeof deger !== 'string' || deger === '') throw new Error(`${ns}/${key}: kimlik ${id} çevirisi boş ya da metin değil`);
      if (kaynakEn) {
        if (!varMi(kaynakEn, String(id))) throw new Error(`${ns}/${key}: kimlik ${id} kaynak parçalarında yok`);
        if (kaynakEn[String(id)] !== e.deger) throw new Error(`${ns}/${key}: kimlik ${id} kaynak metni locres değeriyle tutmuyor (kaynak başka bir build'den)`);
      }
      kullanilan.add(String(id));
    }
    const d = anahtarDizgisi(ns, key);
    if (baslikAdi.has(d)) {
      baslikBulunan.add(d);
      const b = baslikYazisi(deger);
      if (b !== deger) baslikDegisen++;
      deger = b;
    }
    return { ns: e.ns, key: e.key, kaynakHash: e.kaynakHash, nsHash: e.nsHash, keyHash: e.keyHash, deger };
  });
  const fazla = Object.keys(ceviri).filter(k => !kullanilan.has(k));
  if (fazla.length) throw new Error(`çeviride ${fazla.length} kimlik hiçbir girişe bağlı değil (ilki ${fazla[0]})`);
  const yok = [...baslikAdi].filter(([d]) => !baslikBulunan.has(d)).map(([, ad]) => ad);
  if (yok.length) throw new Error(`başlık listesindeki ${yok.length} anahtar locres'te yok (ilki ${yok[0]}): oyun build'i değişmiş, "node tools/taslak/goudy-export.mjs --json ceviri/baslik-yazi-tipi.json" ile yeniden üret`);
  return { girisler, sayilar: { toplam: girisler.length, bos, cevrilen: kullanilan.size, baslik: baslikAdi.size, baslikDegisen } };
}

/** Türkçe locres girişlerinden locres baytları (sürüm 3). */
export function trLocresBayt(girisler) { return locresYaz({ surum: 3, girisler }); }

/**
 * Locres baytlarını (ve varsa ek dosyaları) yama pakına sarar. Döner: pak baytları.
 * `ekDosyalar` verilmezse pak tek dosyalıdır (yalnız locres), eski davranış aynen.
 * @param {Buffer} locresBayt @param {{yol:string, veri:Buffer}[]} [ekDosyalar] locres'ten SONRA, verilen sırayla paklanır
 */
export function yamaPakKur(locresBayt, ekDosyalar = []) {
  if (!Array.isArray(ekDosyalar)) throw new Error('yamaPakKur: ekDosyalar bir dizi olmalı');
  return pakYaz({ dosyalar: [{ yol: YAMA_LOCRES_YOLU, veri: locresBayt }, ...ekDosyalar] });
}

/**
 * Oyunun özgün dil listesi varlığına `YAMA_DIL` satırını ekler ve `yamaPakKur`un `ekDosyalar` biçiminde döndürür (uasset, sonra uexp).
 * Hata fırlatır (sessiz geçmez): düzen tanınmazsa · `tr` etiketi özgün listede zaten varsa (oyun kendi `tr` satırını getirmişse
 * ikinci satır eklenmesin) · kitaplığın kendi geri okuması tutmazsa.
 */
export function dilVarligiEkDosyalari(ozgunUasset, ozgunUexp) {
  const { uasset, uexp } = dilSatiriEkle(ozgunUasset, ozgunUexp, YAMA_DIL);
  return [{ yol: YAMA_DIL_UASSET_YOLU, veri: uasset }, { yol: YAMA_DIL_UEXP_YOLU, veri: uexp }];
}

/** Oyunun özgün başlık yazı tipinden yamalı kopyayı üretir ve `yamaPakKur`un `ekDosyalar` biçiminde döndürür. */
export function yaziTipiEkDosyasi(ozgunBayt) {
  return [{ yol: YAMA_YAZI_TIPI_YOLU, veri: iNoktaliYap(ozgunBayt) }];
}
