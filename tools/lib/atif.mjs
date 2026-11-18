// UE4 varlık atıf tarayıcısı. YALNIZCA OKUR.
// "A, B'ye atıf ediyor" = A'nın .uasset dosyasında (ad tablosunda) B'nin paket yolu geçiyor.
// Neden uasset: derlenmiş (cooked) pakette bir varlığın dışarıya bağları ad tablosunda yazılı;
// 28 bin uasset toplam ~70 MB, yani oyunu açmadan her koşumda taranabilir.
//
// Bu tarayıcı şunu GÖREMEZ: atıfın varlığın hangi alanında kullanıldığını (başlık mı, gövde mi) ·
// çalışma anında dizgeden kurulan yolları · yalnızca .uexp içine gömülü ham yol dizgelerini ·
// sınıf kalıtımı ile gerçek kullanımı ayıramaz (alt tür, ana türe atıf eder; yazı tipini kendisi
// kullanıyor mu bilinmez).
const OYUN_KOKU = 'ModernStoryteller01/Content/';

/**
 * Pak girişinin yolunu bağlama noktasına göre 'ModernStoryteller01/Content/…' köküne tamamlar.
 * pakchunk0'ın bağlama noktası '../../../' (yol zaten tam), pakchunk1'inki alt klasör
 * ('…/0Game/VisualStyles/') ve girişleri o klasöre göre göreli: tamamlanmazsa atlanır.
 */
export function tamYol(pk, g) {
  return pk.baglamaNoktasi.replace(/^(\.\.\/)+/, '') + g.yol;
}

/** 'ModernStoryteller01/Content/0Game/X.uasset' → '/Game/0Game/X' (oyun içeriği değilse null) */
export function paketYolu(girisYolu) {
  if (!girisYolu.startsWith(OYUN_KOKU) || !girisYolu.endsWith('.uasset')) return null;
  return '/Game/' + girisYolu.slice(OYUN_KOKU.length, -'.uasset'.length);
}

/** '/Game/0Game/X' → 'ModernStoryteller01/Content/0Game/X.<uzanti>' */
export function pakYolu(paket, uzanti) {
  return OYUN_KOKU + paket.slice('/Game/'.length) + '.' + uzanti;
}

/** metinde `yol` bir ad olarak geçiyor mu? "X" ile "X_Font" birbirine karışmasın diye sonraki karaktere bakar. */
export function yolGeciyorMu(metin, yol) {
  let i = 0;
  while ((i = metin.indexOf(yol, i)) !== -1) {
    const sonraki = metin[i + yol.length];
    if (sonraki === undefined || !/[A-Za-z0-9_]/.test(sonraki)) return true;
    i += yol.length;
  }
  return false;
}

/** Oyun içeriğindeki bütün uasset'lerin ad tablosu metnini okur: Map(paket yolu → latin1 metin). */
export function uassetIcerikleri(hepsi) {
  const m = new Map();
  for (const { pk, g } of hepsi) {
    const y = paketYolu(tamYol(pk, g));
    if (y) m.set(y, pk.icerik(g).toString('latin1'));
  }
  return m;
}

/**
 * Hedefe atıf edenleri basamak basamak bulur: 1. basamak hedefe doğrudan atıf edenler,
 * 2. basamak onlara atıf edenler… Boş basamakta durur. Hedef haritada yoksa hata fırlatır
 * (sessizce "kimse kullanmıyor" demesin).
 * @param {Map<string,string>} icerikler paket yolu → uasset metni
 * @returns {string[][]} basamak listesi
 */
export function atifBasamaklari(icerikler, hedef, basamak = 4) {
  if (!icerikler.has(hedef)) throw new Error(`atıf hedefi pakette yok: ${hedef}`);
  const goruldu = new Set([hedef]);
  let seviye = [hedef];
  const sonuc = [];
  for (let b = 0; b < basamak; b++) {
    const yeni = [];
    for (const [yol, metin] of icerikler) {
      if (goruldu.has(yol)) continue;
      if (seviye.some(h => yolGeciyorMu(metin, h))) { yeni.push(yol); goruldu.add(yol); }
    }
    if (!yeni.length) break;
    sonuc.push(yeni);
    seviye = yeni;
  }
  return sonuc;
}
