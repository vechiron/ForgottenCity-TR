// Oyunun dil listesi varlığı (`0Game/LanguageTagToNames`: uasset + uexp) okuyucusu ve satır ekleyicisi. SAF: diske ve oyuna dokunmaz.
//
// Neden var: oyunun Dil satırı `tr` etiketini bu listede bulamayınca ham "tr" yazıyor. Listeye `tr` + "Türkçe" satırı eklenince
// menüde ad görünür. Yama pakı bu varlığın yeni hâlini (uasset + uexp) oyunun kendisininkinin üstüne koyar.
//
// Bu dosya YALNIZ bu varlığın ölçülmüş düzenini bilir (13.11.2026, oyunun `pakchunk0`ındaki 1172 + 993 bayt; ayrıntı
// `docs/oyun-haritasi.md` "Menüde göster"): sürümsüz (FileVersionUE4 0) paket, tek export, kök özellik `Names` (dizi, eleman türü
// `FLangTagToLocalizedName` yapısı, her satır `TagName` + `LocalizedName`). Başka bir düzen görünce HATA FIRLATIR, sessiz geçmez:
// oyun güncellenip varlık değişirse yanlış baytlar yazmaktansa üretim durur.
//
// Bu dosya şunu GÖREMEZ: motorun yamalı varlığı yükleyip menüde "Türkçe" gösterdiği (oyunda denenmedi) · `LangNameLookup` Blueprint'inin
// değişmez metni kullandığı · `BulkDataStartOffset`in başka varlıkta aynı anlamı taşıdığı (bu varlıkta başlık + SerialSize'a eşit
// çıktı; alanın yeri DEĞERİNDEN bulunur, özet düzeni baştan sona çözülmez).

const PAKET_ETIKETI = 0x9E2A83C1;                       // uasset başında ve uexp sonunda
const IHRACAT_KAYIT_BOYU = 104;                         // export kaydı (bu varlıkta ölçüldü)
const IHRACAT_SERIAL_SIZE = 28;                         // kayıt içinde int64
const IHRACAT_SERIAL_OFFSET = 36;                       // kayıt içinde int64
const PKG_FILTER_EDITOR_ONLY = 0x80000000;

// ---------------------------------------------------------------- düşük düzey okuma
function fstringOku(b, o) {
  const uzunluk = b.readInt32LE(o);
  if (uzunluk === 0) return { metin: '', son: o + 4 };
  if (uzunluk > 0) {
    if (b[o + 4 + uzunluk - 1] !== 0) throw new Error('dil varlığı: FString sonunda NUL yok');
    return { metin: b.toString('latin1', o + 4, o + 4 + uzunluk - 1), son: o + 4 + uzunluk };
  }
  const n = -uzunluk;
  if (b.readUInt16LE(o + 4 + (n - 1) * 2) !== 0) throw new Error('dil varlığı: UTF-16 FString sonunda NUL yok');
  return { metin: b.toString('utf16le', o + 4, o + 4 + (n - 1) * 2), son: o + 4 + n * 2 };
}

/** FString baytları: yalnız ASCII ise tek baytlık (uzunluk + 1), değilse UTF-16 (uzunluk negatif, NUL dahil). */
function fstringYaz(metin) {
  if (/^[\x00-\x7f]*$/.test(metin)) {
    const b = Buffer.alloc(4 + metin.length + 1); b.writeInt32LE(metin.length + 1, 0); b.write(metin, 4, 'latin1'); return b;
  }
  const b = Buffer.alloc(4 + (metin.length + 1) * 2); b.writeInt32LE(-(metin.length + 1), 0); b.write(metin, 4, 'utf16le'); return b;
}

const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const ad8 = (indeks) => { const b = Buffer.alloc(8); b.writeInt32LE(indeks, 0); return b; };   // FName: ad tablosu indeksi + sayı (0)

// ---------------------------------------------------------------- uasset özeti
/**
 * uasset özetinin bu varlıkta ölçülen düzenini çözer ve uexp ile ÇAPRAZ doğrular. Döner:
 * { adlar, ihracOfset, serialSizeOfset, serialSize, bulkOfset, toplamBaslik }.
 */
function ozetCoz(uasset, uexp) {
  if (!Buffer.isBuffer(uasset) || !Buffer.isBuffer(uexp)) throw new Error('dil varlığı: uasset ve uexp Buffer olmalı');
  if (uasset.length < 200 || uasset.readUInt32LE(0) !== PAKET_ETIKETI) throw new Error('dil varlığı: uasset başlığı tanınmadı');
  if (uexp.length < 8 || uexp.readUInt32LE(uexp.length - 4) !== PAKET_ETIKETI) throw new Error('dil varlığı: uexp sonunda paket etiketi yok');
  if (uasset.readInt32LE(4) !== -7) throw new Error(`dil varlığı: LegacyFileVersion ${uasset.readInt32LE(4)}, bu kütüphane yalnız -7 bilir`);
  if (uasset.readInt32LE(12) !== 0 || uasset.readInt32LE(16) !== 0) throw new Error('dil varlığı: paket sürümsüz (FileVersionUE4 0) değil, düzen bilinmiyor');
  if (uasset.readInt32LE(20) !== 0) throw new Error('dil varlığı: özel sürüm kaydı var, düzen bilinmiyor');
  const toplamBaslik = uasset.readInt32LE(24);
  if (toplamBaslik !== uasset.length) throw new Error(`dil varlığı: TotalHeaderSize ${toplamBaslik} ≠ uasset boyu ${uasset.length}`);
  let o = 28;
  const klasor = fstringOku(uasset, o); o = klasor.son;
  const bayraklar = uasset.readUInt32LE(o); o += 4;
  if (!(bayraklar & PKG_FILTER_EDITOR_ONLY)) throw new Error('dil varlığı: PKG_FilterEditorOnly kapalı, düzen bilinmiyor');
  const adSayisi = uasset.readInt32LE(o), adOfset = uasset.readInt32LE(o + 4); o += 8;
  o += 8;                                                // GatherableTextData sayısı ve ofseti
  const ihracSayisi = uasset.readInt32LE(o), ihracOfset = uasset.readInt32LE(o + 4);
  if (ihracSayisi !== 1) throw new Error(`dil varlığı: ${ihracSayisi} export var, 1 bekleniyordu`);
  if (ihracOfset + IHRACAT_KAYIT_BOYU > toplamBaslik) throw new Error('dil varlığı: export kaydı başlığın dışında');
  // ad tablosu: FString + iki uint16 karma
  const adlar = []; let p = adOfset;
  for (let n = 0; n < adSayisi; n++) { const f = fstringOku(uasset, p); adlar.push(f.metin); p = f.son + 4; }
  // export kaydı
  const serialSizeOfset = ihracOfset + IHRACAT_SERIAL_SIZE;
  const serialSize = Number(uasset.readBigInt64LE(serialSizeOfset));
  const serialOffset = Number(uasset.readBigInt64LE(ihracOfset + IHRACAT_SERIAL_OFFSET));
  if (serialOffset !== toplamBaslik) throw new Error(`dil varlığı: export SerialOffset ${serialOffset} ≠ başlık boyu ${toplamBaslik}`);
  if (serialSize !== uexp.length - 4) throw new Error(`dil varlığı: export SerialSize ${serialSize} ≠ uexp boyu − 4 (${uexp.length - 4})`);
  // BulkDataStartOffset (int64) = başlık + SerialSize: yeri değerinden bulunur, özette TAM BİR eşleşme şart
  const bulkDegeri = BigInt(toplamBaslik + serialSize);
  const bulkAdaylari = [];
  for (let k = 0; k + 8 <= ihracOfset; k++) if (uasset.readBigInt64LE(k) === bulkDegeri) bulkAdaylari.push(k);
  if (bulkAdaylari.length !== 1) throw new Error(`dil varlığı: BulkDataStartOffset adayı ${bulkAdaylari.length} (başlık + SerialSize = ${bulkDegeri}), tam 1 bekleniyordu`);
  return { adlar, ihracOfset, serialSizeOfset, serialSize, bulkOfset: bulkAdaylari[0], toplamBaslik };
}

// ---------------------------------------------------------------- uexp: Names dizisi
/** Özellik etiketini okur: { ad, tur, boyut, boyutOfset, veri (değerin başladığı ofset) }. Yapı/dizi/bool üst bilgisini ÇÖZMEZ. */
function etiketOku(uexp, adlar, o) {
  const adIdx = uexp.readInt32LE(o);
  if (adIdx < 0 || adIdx >= adlar.length) throw new Error(`dil varlığı: ad indeksi ${adIdx} tablo dışında (uexp ofset ${o})`);
  if (adlar[adIdx] === 'None') return { ad: 'None', son: o + 8 };
  const turIdx = uexp.readInt32LE(o + 8);
  if (turIdx < 0 || turIdx >= adlar.length) throw new Error(`dil varlığı: tür indeksi ${turIdx} tablo dışında (uexp ofset ${o + 8})`);
  return { ad: adlar[adIdx], tur: adlar[turIdx], boyut: uexp.readInt32LE(o + 16), boyutOfset: o + 16, ustSon: o + 24 };
}

function metinOku(uexp, adlar, o, boyut) {
  const son = o + boyut;
  const bayrak = uexp.readUInt32LE(o);
  const gecmis = uexp.readInt8(o + 4);
  let p = o + 5, sonuc;
  if (gecmis === 11) {
    const tabloIdx = uexp.readInt32LE(p);
    if (tabloIdx < 0 || tabloIdx >= adlar.length) throw new Error('dil varlığı: StringTable adı indeksi tablo dışında');
    const anahtar = fstringOku(uexp, p + 8); p = anahtar.son;
    sonuc = { tur: 'tablo', tablo: adlar[tabloIdx], anahtar: anahtar.metin };
  } else if (gecmis === -1) {
    const varMi = uexp.readInt32LE(p); p += 4;
    if (varMi !== 0 && varMi !== 1) throw new Error(`dil varlığı: bHasCultureInvariantString ${varMi}`);
    if (varMi === 1) { const f = fstringOku(uexp, p); p = f.son; sonuc = { tur: 'degismez', metin: f.metin, bayrak }; }
    else sonuc = { tur: 'degismez', metin: '', bayrak };
  } else throw new Error(`dil varlığı: bilinmeyen metin geçmişi türü ${gecmis}`);
  if (p !== son) throw new Error(`dil varlığı: metin değeri ${p - o} bayt, etiket boyutu ${boyut}`);
  return sonuc;
}

/**
 * Kök özellik `Names` dizisini çözer. Döner:
 * { diziBoyutOfset, sayiOfset, icBoyutOfset, elemanBas, elemanSon, satirlar: [{ etiket, ad, bas, son }] }
 * `ad`: { tur: 'tablo', tablo, anahtar } ya da { tur: 'degismez', metin, bayrak }. Bas/son: satırın uexp'teki bayt aralığı.
 */
function diziCoz(uexp, adlar) {
  const kok = etiketOku(uexp, adlar, 0);
  if (kok.ad !== 'Names' || kok.tur !== 'ArrayProperty') throw new Error(`dil varlığı: ilk özellik "${kok.ad}" (${kok.tur}), "Names" (ArrayProperty) bekleniyordu`);
  const icTur = adlar[uexp.readInt32LE(kok.ustSon)];
  if (icTur !== 'StructProperty') throw new Error(`dil varlığı: dizi eleman türü ${icTur}, StructProperty bekleniyordu`);
  if (uexp[kok.ustSon + 8] !== 0) throw new Error('dil varlığı: Names etiketinde özellik kimliği (GUID) var, düzen bilinmiyor');
  const sayiOfset = kok.ustSon + 9;
  const sayi = uexp.readInt32LE(sayiOfset);
  const diziSon = sayiOfset + kok.boyut;                 // boyut, baştaki eleman sayısını (4 bayt) da kapsar
  const ic = etiketOku(uexp, adlar, sayiOfset + 4);
  if (ic.ad !== 'Names' || ic.tur !== 'StructProperty') throw new Error('dil varlığı: dizi iç etiketi Names/StructProperty değil');
  const yapiAdi = adlar[uexp.readInt32LE(ic.ustSon)];
  if (yapiAdi !== 'FLangTagToLocalizedName') throw new Error(`dil varlığı: yapı adı "${yapiAdi}", FLangTagToLocalizedName bekleniyordu`);
  if (uexp[ic.ustSon + 8 + 16] !== 0) throw new Error('dil varlığı: iç etikette özellik kimliği (GUID) var, düzen bilinmiyor');
  const elemanBas = ic.ustSon + 8 + 16 + 1;
  const elemanSon = elemanBas + ic.boyut;
  if (elemanSon !== diziSon) throw new Error(`dil varlığı: elemanların sonu ${elemanSon}, dizi sonu ${diziSon}`);
  const satirlar = [];
  let p = elemanBas;
  for (let n = 0; n < sayi; n++) {
    const bas = p; let etiket = null, ad = null;
    for (;;) {
      const e = etiketOku(uexp, adlar, p);
      if (e.ad === 'None') { p = e.son; break; }
      if (uexp[e.ustSon] !== 0) throw new Error(`dil varlığı: ${e.ad} etiketinde özellik kimliği (GUID) var, düzen bilinmiyor`);
      const veri = e.ustSon + 1;
      if (/^TagName_/.test(e.ad) && e.tur === 'StrProperty') {
        const f = fstringOku(uexp, veri); if (f.son !== veri + e.boyut) throw new Error('dil varlığı: TagName boyutu tutmuyor');
        etiket = f.metin;
      } else if (/^LocalizedName_/.test(e.ad) && e.tur === 'TextProperty') ad = metinOku(uexp, adlar, veri, e.boyut);
      else throw new Error(`dil varlığı: satırda beklenmeyen özellik ${e.ad} (${e.tur})`);
      p = veri + e.boyut;
    }
    if (etiket === null || ad === null) throw new Error(`dil varlığı: ${n}. satırda TagName ya da LocalizedName yok`);
    satirlar.push({ etiket, ad, bas, son: p });
  }
  if (p !== elemanSon) throw new Error(`dil varlığı: ${sayi} satır çözüldü, bitiş ${p} ≠ ${elemanSon}`);
  return { diziBoyutOfset: kok.boyutOfset, sayiOfset, icBoyutOfset: ic.boyutOfset, elemanBas, elemanSon, satirlar };
}

/** Dil satırları: [{ etiket, ad }] (bayt aralıkları dışarı verilmez). Başlığı çapraz doğrular, düzen tanınmazsa hata fırlatır. */
export function dilSatirlari(uasset, uexp) {
  const ozet = ozetCoz(uasset, uexp);
  return diziCoz(uexp, ozet.adlar).satirlar.map(({ etiket, ad }) => ({ etiket, ad }));
}

function adIndeksi(adlar, desen, ne) {
  const bulunan = adlar.map((a, i) => [a, i]).filter(([a]) => (desen instanceof RegExp ? desen.test(a) : a === desen));
  if (bulunan.length !== 1) throw new Error(`dil varlığı: ad tablosunda ${ne} için ${bulunan.length} aday var, 1 bekleniyordu`);
  return bulunan[0][1];
}

/** Yeni satırın baytları: TagName (StrProperty) + LocalizedName (TextProperty, değişmez metin) + None. */
function satirKur(adlar, etiket, ad) {
  const tagAdi = adIndeksi(adlar, /^TagName_/, 'TagName'), strTur = adIndeksi(adlar, 'StrProperty', 'StrProperty');
  const yerelAdi = adIndeksi(adlar, /^LocalizedName_/, 'LocalizedName'), metinTur = adIndeksi(adlar, 'TextProperty', 'TextProperty');
  const yok = adIndeksi(adlar, 'None', 'None');
  const etiketDeger = fstringYaz(etiket);
  // değişmez metin: bayrak 2 (CultureInvariant) · geçmiş türü −1 · bHasCultureInvariantString 1 · FString
  const metinDeger = Buffer.concat([i32(2), Buffer.from([0xFF]), i32(1), fstringYaz(ad)]);
  const ozellik = (adIdx, turIdx, deger) => Buffer.concat([ad8(adIdx), ad8(turIdx), i32(deger.length), i32(0), Buffer.from([0]), deger]);
  return Buffer.concat([ozellik(tagAdi, strTur, etiketDeger), ozellik(yerelAdi, metinTur, metinDeger), ad8(yok)]);
}

/**
 * Dil listesine bir satır ekler (SONA), başlık ve boyut alanlarını günceller, çıktıyı yeniden okuyup doğrular.
 * @param {Buffer} uasset @param {Buffer} uexp @param {{etiket:string, ad:string}} yeni `ad`: değişmez metin olarak yazılır
 * @returns {{uasset:Buffer, uexp:Buffer, eklenenBayt:number}}  Girdi Buffer'lara dokunmaz (kopya).
 * Hata fırlatır: düzen tanınmazsa · etiket zaten varsa · çıktı yeniden okununca satırlar beklenenle tutmuyorsa.
 */
export function dilSatiriEkle(uasset, uexp, { etiket, ad }) {
  if (typeof etiket !== 'string' || !etiket || typeof ad !== 'string' || !ad) throw new Error('dil varlığı: etiket ve ad dolu metin olmalı');
  const ozet = ozetCoz(uasset, uexp);
  const dizi = diziCoz(uexp, ozet.adlar);
  if (dizi.satirlar.some(s => s.etiket === etiket)) throw new Error(`dil varlığı: "${etiket}" etiketi listede zaten var`);
  const yeniSatir = satirKur(ozet.adlar, etiket, ad);
  const uexpYeni = Buffer.concat([uexp.subarray(0, dizi.elemanSon), yeniSatir, uexp.subarray(dizi.elemanSon)]);
  uexpYeni.writeInt32LE(uexp.readInt32LE(dizi.diziBoyutOfset) + yeniSatir.length, dizi.diziBoyutOfset);
  uexpYeni.writeInt32LE(uexp.readInt32LE(dizi.icBoyutOfset) + yeniSatir.length, dizi.icBoyutOfset);
  uexpYeni.writeInt32LE(dizi.satirlar.length + 1, dizi.sayiOfset);
  const uassetYeni = Buffer.from(uasset);
  uassetYeni.writeBigInt64LE(BigInt(ozet.serialSize + yeniSatir.length), ozet.serialSizeOfset);
  uassetYeni.writeBigInt64LE(BigInt(ozet.toplamBaslik + ozet.serialSize + yeniSatir.length), ozet.bulkOfset);
  // kendi çıktısını yeniden oku: ilk satırların baytları aynı, sonuncusu yeni, hepsi tutarlı
  const yeniOzet = ozetCoz(uassetYeni, uexpYeni);
  const yeniDizi = diziCoz(uexpYeni, yeniOzet.adlar);
  if (yeniDizi.satirlar.length !== dizi.satirlar.length + 1) throw new Error('dil varlığı: ekleme sonrası satır sayısı tutmuyor');
  if (!uexpYeni.subarray(dizi.elemanBas, dizi.elemanSon).equals(uexp.subarray(dizi.elemanBas, dizi.elemanSon))) throw new Error('dil varlığı: özgün satırların baytları değişmiş');
  const son = yeniDizi.satirlar[yeniDizi.satirlar.length - 1];
  if (son.etiket !== etiket || son.ad.tur !== 'degismez' || son.ad.metin !== ad) throw new Error('dil varlığı: eklenen satır geri okununca tutmuyor');
  return { uasset: uassetYeni, uexp: uexpYeni, eklenenBayt: yeniSatir.length };
}
