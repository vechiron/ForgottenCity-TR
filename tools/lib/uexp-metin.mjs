// UE4 .uexp içindeki FText kayıtlarını (oyuncuya görünen metin) çözer. YALNIZCA OKUR.
//
// Yöntem (kesin): uasset ad tablosunda "TextProperty" adının sırası bulunur; .uexp'te o adın bulunduğu
// özellik etiketleri aranır ve değerin boyutu etiketteki boyutla TUTMAK ZORUNDA (tutmayan sayılmaz).
//   tek etiket   : [ad 8][tür 8 = TextProperty][boyut 4][dizin 4][guid bayrağı 1 (+16)] değer = FText
//   dizi etiketi : [ad 8][ArrayProperty 8][boyut 4][dizin 4][iç tür 8 = TextProperty][guid 1] değer = sayı + FText'ler
// FText değeri: bayrak(4) + geçmiş türü(1) + türe göre alanlar:
//   0 Base: ad alanı, anahtar, kaynak metin (üçü de FString) · -1 None: boş ya da değişmez metin
//   11 StringTableEntry: tablo adı (FName 8) + anahtar (FString) · 1-10 ve 12 çözülmez (sayılır).
// Sezgisel tarama (sezgiselAdaylar) yalnızca ÇAPRAZ DOĞRULAMA içindir: etiket aramadan, bayt desenine bakar.
//
// Bu okuyucu şunu GÖREMEZ: harita (TMap) ve küme içindeki FText'i (etiketsiz yazılıyor; çapraz doğrulama bunların
// anahtarlı Base olanlarını bulur) · metnin oyunda oyuncuya gösterilip gösterilmediğini · çalışma anında
// kurulan metni (Format/Join sonuçlarını) · Blueprint bayt kodundaki metin sabitlerini (EX_TextConst; ayrı biçim).
// Boyutu tutmayan TextProperty geçişleri (sayac.boyutTutmayan) reddedilir, metin sayılmaz. Örneklerde bunların adı
// nesne yolu; sınıfın "bu değişken Text türünde" bildirimine benziyor ama SAYIYLA DOĞRULANMADI: reddedilenlerin
// arasında gerçek metin kaçıyor olabilir.
const UASSET_SIHIR = 0x9E2A83C1;

/** FString oku, hata fırlatmadan: [metin, sonrakiOfset] ya da geçersizse null. enFazla: izin verilen uzunluk. */
function fstringBak(b, p, enFazla = 1_000_000) {
  if (p < 0 || p + 4 > b.length) return null;
  const n = b.readInt32LE(p);
  if (n === 0) return ['', p + 4];
  if (n > 0) {
    if (n > enFazla || p + 4 + n > b.length || b[p + 4 + n - 1] !== 0) return null;
    return [b.toString('latin1', p + 4, p + 4 + n - 1), p + 4 + n];
  }
  const m = -n;
  if (m > enFazla || p + 4 + m * 2 > b.length || b.readUInt16LE(p + 4 + m * 2 - 2) !== 0) return null;
  return [b.toString('utf16le', p + 4, p + 4 + m * 2 - 2), p + 4 + m * 2];
}

/** FString oku: [metin, sonrakiOfset]. Sınır dışı ya da yazım bozuksa hata fırlatır. */
export function fstring(b, p) {
  const r = fstringBak(b, p);
  if (!r) throw new RangeError(`FString bozuk ya da dosya dışında (@${p})`);
  return r;
}

/** .uasset ad tablosu: string[] (FName sırası = dizin). UE4.2x (LegacyFileVersion -7) dışında hata verir. */
export function adTablosu(u) {
  if (u.length < 64 || u.readUInt32LE(0) !== UASSET_SIHIR) throw new Error('uasset sihirli sayısı yanlış');
  let p = 4;
  const eski = u.readInt32LE(p); p += 4;
  if (eski !== -7) throw new Error(`beklenmeyen LegacyFileVersion ${eski} (okuyucu yalnızca -7 için yazıldı)`);
  p += 4;                                        // LegacyUE3Version
  const surum = u.readInt32LE(p); p += 4;        // FileVersionUE4 (0 = sürümsüz cook: motorun kendi sürümü varsayılır)
  if (surum !== 0 && surum < 504) throw new Error(`FileVersionUE4 ${surum} < 504: ad tablosunda karma yok, okuyucu bunu bilmiyor`);
  p += 4;                                        // FileVersionLicenseeUE4
  const cv = u.readInt32LE(p); p += 4;
  if (cv < 0 || cv > 10000) throw new Error('özel sürüm sayısı makul değil');
  p += cv * 20;                                  // her biri GUID(16) + sürüm(4)
  p += 4;                                        // TotalHeaderSize
  p = fstring(u, p)[1];                          // FolderName
  p += 4;                                        // PackageFlags
  const sayi = u.readInt32LE(p), ofset = u.readInt32LE(p + 4);
  if (sayi < 0 || sayi > 5_000_000 || ofset < 0 || ofset >= u.length) throw new Error('ad tablosu künyesi makul değil');
  const adlar = []; let q = ofset;
  for (let i = 0; i < sayi; i++) { const [s, y] = fstring(u, q); adlar.push(s); q = y + 4; }   // +4: iki karma (uint16)
  return adlar;
}

/** Tek FText değeri çöz. Dönen son = değerin bittiği ofset. */
function ftextCoz(adlar, b, p, sinir) {
  if (p + 5 > sinir) throw new RangeError('FText değeri sınırdan taşıyor');
  const bayrak = b.readUInt32LE(p), tur = b.readInt8(p + 4);
  let q = p + 5;
  if (tur === 0) {
    const ns = fstring(b, q), key = fstring(b, ns[1]), src = fstring(b, key[1]);
    return { tur, bayrak, ns: ns[0], key: key[0], src: src[0], son: src[1] };
  }
  if (tur === -1) {
    const var_ = b.readInt32LE(q); q += 4;
    if (var_ !== 0 && var_ !== 1) throw new RangeError('None geçmişinde bayrak 0/1 değil');
    if (var_) { const s = fstring(b, q); return { tur, bayrak, ns: '', key: '', src: s[0], son: s[1], degismez: true }; }
    return { tur, bayrak, ns: '', key: '', src: '', son: q, bos: true };
  }
  if (tur === 11) {
    const tablo = adlar[b.readInt32LE(q)]; if (tablo === undefined) throw new RangeError('tablo adı ad tablosunda yok');
    const key = fstring(b, q + 8);
    return { tur, bayrak, ns: tablo, key: key[0], src: '', son: key[1], tablo: true };
  }
  if (tur < -1 || tur > 12) throw new RangeError(`geçersiz geçmiş türü ${tur}`);
  return { tur, bayrak, ns: '', key: '', src: '', son: sinir, cozulmedi: true };   // 1-10, 12: sınıflandırılır, çözülmez
}

/**
 * Etiketli FText kayıtları. kayit[]: { o (değer başı), tur, bayrak, ns, key, src, dizi? }.
 * sayac: { tek, dizi, diziElemani, boyutTutmayan, diziCozulmeyen }.
 */
export function ftextler(adlar, b) {
  const idx = adlar.indexOf('TextProperty');
  const kayit = [], sayac = { tek: 0, dizi: 0, diziElemani: 0, boyutTutmayan: 0, diziCozulmeyen: 0 };
  if (idx < 0) return { kayit, sayac };
  for (let o = 8; o + 17 <= b.length; o++) {
    if (b.readInt32LE(o) !== idx || b.readInt32LE(o + 4) !== 0) continue;
    // (a) dizi etiketinin iç türü mü?
    if (o >= 24 && adlar[b.readInt32LE(o - 16)] === 'ArrayProperty' && b.readInt32LE(o - 12) === 0) {
      const boyut = b.readInt32LE(o - 8), g = b[o + 8];
      if (boyut >= 4 && boyut < 4_000_000 && g <= 1) {
        const bas = o + 9 + (g ? 16 : 0), bit = bas + boyut;
        if (bit <= b.length) {
          try {
            const n = b.readInt32LE(bas); let q = bas + 4; const parca = []; let tamam = n >= 0 && n < 100000;
            for (let i = 0; tamam && i < n; i++) {
              const r = ftextCoz(adlar, b, q, bit);
              if (r.cozulmedi || r.son > bit) { tamam = false; break; }
              parca.push({ o: q, dizi: true, ...r }); q = r.son;
            }
            if (tamam && q === bit) { kayit.push(...parca); sayac.dizi++; sayac.diziElemani += parca.length; continue; }
            sayac.diziCozulmeyen++;
          } catch { sayac.diziCozulmeyen++; }
        }
      }
    }
    // (b) tek etiket
    const boyut = b.readInt32LE(o + 8), dizin = b.readInt32LE(o + 12), g = b[o + 16];
    if (boyut < 5 || boyut > 4_000_000 || dizin < 0 || dizin > 1000 || g > 1) { sayac.boyutTutmayan++; continue; }
    const bas = o + 17 + (g ? 16 : 0);
    if (bas + boyut > b.length) { sayac.boyutTutmayan++; continue; }
    try {
      const r = ftextCoz(adlar, b, bas, bas + boyut);
      if (r.son !== bas + boyut) { sayac.boyutTutmayan++; continue; }
      kayit.push({ o: bas, ...r }); sayac.tek++;
    } catch { sayac.boyutTutmayan++; }
  }
  return { kayit, sayac };
}

/** Katı FString (çapraz doğrulama için): ASCII ya da düzgün UTF-16, kontrol karakteri yok; değilse null. */
function katiFstring(b, p) {
  // sıcak yol (her sıfır baytta çağrılır): istisna fırlatmaz, uzunluk 20000 ile sınırlı
  const r = fstringBak(b, p, 20000);
  if (!r) return null;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(r[0])) return null;
  if (b.readInt32LE(p) > 0 && /[^\x00-\x7e]/.test(r[0])) return null;   // ANSI yazıda ASCII dışı: UE böyle yazmaz
  return r;
}

/**
 * Çapraz doğrulama: etiket aramadan, "bayrak + tür 0 + üç FString" desenini tarar.
 * Çakışan adaylardan anahtarı dolu olan seçilir (bayrak baytlarını ad alanı sanan sahte ikiz, anahtarı boş çıkar).
 * Döner: { o (TÜR BAYTI; etiketli kaydın o'su değer başı = bu o - 4), ns, key, src, son }.
 * Yalnızca anahtarı boş ya da 32 onaltılık hane olan kayıtları bulur (adlı anahtarlıları kaçırır).
 */
export function sezgiselAdaylar(b) {
  const aday = [];
  for (let o = 4; o + 13 < b.length; o++) {
    if (b[o] !== 0 || b.readUInt32LE(o - 4) > 0x1f) continue;
    const ns = katiFstring(b, o + 1); if (!ns) continue;
    const key = katiFstring(b, ns[1]); if (!key) continue;
    const src = katiFstring(b, key[1]); if (!src || src[0].length < 1) continue;
    if (key[0] !== '' && !/^[0-9A-F]{32}$/.test(key[0])) continue;
    aday.push({ o, ns: ns[0], key: key[0], src: src[0], son: src[1] });
  }
  const iyi = (x, y) => (x.key !== '') !== (y.key !== '') ? x.key !== '' : x.son > y.son;
  const secilen = [];
  for (const a of aday) {
    const son = secilen[secilen.length - 1];
    if (son && a.o < son.son) { if (iyi(a, son)) secilen[secilen.length - 1] = a; } else secilen.push(a);
  }
  return secilen;
}
