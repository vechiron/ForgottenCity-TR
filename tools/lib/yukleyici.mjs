// Yükleyicinin çekirdeği: oyunu bulur, yama dosyasını kurar ve kaldırır. Yalnız `Content/Paks/` altındaki TEK dosyaya
// (`pakchunk0-WindowsNoEditor_P.pak`) yazar; orijinal paklara, kayıt dosyalarına ve oyunun ayarlarına dokunmaz; ağa çıkmaz.
// Pak üretimi buraya bağlı değil: çağıran iki işlev verir (`kaynakUret`, `pakUret`), böylece çekirdek sahte oyun klasörüyle
// sınanır (`node tools/yukleyici.mjs --sina`).
//
// Bu çekirdek şunu GÖREMEZ: Steam'in "dosyaları doğrula" ya da güncellemesinin `_P.pak`ı silip silmediğini · pakın motorda
// yüklendiğini (oyunda ayrıca bakılır) · Steam dışı mağazaların klasör düzenini (yalnız beklenen `ModernStoryteller01/Content/Paks`
// düzenini doğrular) · Windows dışı sistemleri · başka kullanıcı hesabının kayıt klasörünü.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { oyunPakAdlari, pakAc } from './pak.mjs';
import { YAMA_LOCRES_YOLU, YAMA_PAK_ADI } from './yama.mjs';

export const STEAM_UYGULAMA_NO = '874260';
export const OYUN_SURECLERI = ['ModernStoryteller01.exe', 'ModernStoryteller01-Win64-Shipping.exe'];

export const sha256Bayt = (b) => createHash('sha256').update(b).digest('hex').toUpperCase();
export const sha256Dosya = (yol) => sha256Bayt(readFileSync(yol));

/** `libraryfolders.vdf` metninden kütüphane klasörlerini çıkarır (`"path"  "D:\\SteamLibrary"`; \\ → \). SAF. */
export function vdfKutuphaneleri(metin) {
  const sonuc = [];
  for (const m of metin.matchAll(/"path"\s+"([^"]*)"/g)) sonuc.push(m[1].replace(/\\\\/g, '\\'));
  return sonuc;
}

/** `appmanifest_*.acf` metninden { installdir, buildid } (yoksa null alanlar). SAF. */
export function manifestOku(metin) {
  const al = (ad) => metin.match(new RegExp(`"${ad}"\\s+"([^"]*)"`))?.[1] ?? null;
  return { installdir: al('installdir'), buildid: al('buildid') };
}

/**
 * Oyunun paket klasörünü doğrular. Döner: { ok, hata, paks, oyunPaklari }. Yalnız okur.
 * Ölçüt: `<oyun>/ModernStoryteller01/Content/Paks` var ve içinde oyunun kendi pak(lar)ı (`_P.pak` dışında) var.
 */
export function oyunDogrula(oyun) {
  const paks = join(oyun, 'ModernStoryteller01', 'Content', 'Paks');
  if (!existsSync(paks)) return { ok: false, hata: `"${oyun}" içinde ModernStoryteller01\\Content\\Paks klasörü yok: bu The Forgotten City klasörü değil`, paks };
  const oyunPaklari = oyunPakAdlari(readdirSync(paks));
  if (!oyunPaklari.length) return { ok: false, hata: `"${paks}" içinde oyunun pak dosyası yok`, paks };
  return { ok: true, hata: null, paks, oyunPaklari };
}

/**
 * Steam kopyasını bulur. `steamKokleri`: Steam kurulum klasörleri (kayıt defterinden ve bilinen yerlerden, çağıran verir).
 * Her kökte kökün kendisi ve `libraryfolders.vdf`teki kütüphaneler taranır; `appmanifest_874260.acf`teki `installdir` kullanılır.
 * Döner: [{ oyun, buildid, kutuphane }] (doğrulananlar; aynı klasör iki kez gelmez).
 */
export function steamOyunlari(steamKokleri) {
  const kutuphaneler = new Set();
  for (const kok of steamKokleri) {
    if (!kok || !existsSync(kok)) continue;
    kutuphaneler.add(kok);
    const vdf = join(kok, 'steamapps', 'libraryfolders.vdf');
    if (existsSync(vdf)) { try { for (const y of vdfKutuphaneleri(readFileSync(vdf, 'utf8'))) kutuphaneler.add(y); } catch { /* bozuk vdf: kökle devam */ } }
  }
  const sonuc = [], goruldu = new Set();
  for (const kut of kutuphaneler) {
    const acf = join(kut, 'steamapps', `appmanifest_${STEAM_UYGULAMA_NO}.acf`);
    if (!existsSync(acf)) continue;
    let m; try { m = manifestOku(readFileSync(acf, 'utf8')); } catch { continue; }
    if (!m.installdir) continue;
    const oyun = join(kut, 'steamapps', 'common', m.installdir);
    const anahtar = oyun.toLowerCase();
    if (goruldu.has(anahtar) || !oyunDogrula(oyun).ok) continue;
    goruldu.add(anahtar);
    sonuc.push({ oyun, buildid: m.buildid, kutuphane: kut });
  }
  return sonuc;
}

/** Hedef pak dosyasının durumu: 'yok' · 'bizim' (pakta Türkçe locres yolu var) · 'yabanci' (başka bir dosya ya da okunamıyor). */
export function hedefDurumu(hedef) {
  if (!existsSync(hedef)) return { durum: 'yok' };
  let pk;
  try {
    pk = pakAc(hedef);
    const bizim = pk.liste().some(g => g.yol === YAMA_LOCRES_YOLU);
    return { durum: bizim ? 'bizim' : 'yabanci' };
  } catch (e) {
    return { durum: 'yabanci', neden: `pak olarak okunamadı: ${e.message}` };
  } finally { try { pk?.kapat(); } catch { /* kapanmış */ } }
}

export function kayitOku(kayitKlasoru) {
  const yol = join(kayitKlasoru, 'kurulum.json');
  if (!existsSync(yol)) return null;
  try { const k = JSON.parse(readFileSync(yol, 'utf8')); return k && typeof k === 'object' && typeof k.sha256 === 'string' ? k : { bozuk: true }; }
  catch { return { bozuk: true }; }
}
function kayitYaz(kayitKlasoru, k) { mkdirSync(kayitKlasoru, { recursive: true }); writeFileSync(join(kayitKlasoru, 'kurulum.json'), `${JSON.stringify(k, null, 2)}\n`); }

/** Oyun açık mı? `surecler`: çalışan süreç adları (çağıran verir, ör. tasklist). Döner: açık olan adlar. */
export function acikSurecler(surecler) {
  const kucuk = new Set(surecler.map(s => s.toLowerCase()));
  return OYUN_SURECLERI.filter(a => kucuk.has(a.toLowerCase()));
}

/**
 * Kurar. Sıra: oyun doğrula → oyun KAPALI mı → hedefte yabancı dosya var mı → kaynak üret → parmak izi → pak üret (çıkış kapısı
 * çağıranın işlevinde) → geçici dosyaya kopyala, SHA256 doğrula → yerine koy → yeniden SHA256 → kayıt.
 * Herhangi bir adım tutmazsa HATA FIRLATIR ve hedefe dokunulmaz (kuru: son yazımdan önce durur).
 * `g`: { oyun, surecler (adlar), kayitKlasoru, beklenenParmakIzi, kaynakUret(): { parmakIzi, build }, pakUret(): pak dosyası yolu,
 *        gunlukle(metin), kuru, kopyala(kaynak, hedef) (varsayılan copyFileSync; sınama bozuk kopyayı buradan taklit eder) }.
 */
export function kur(g) {
  const adim = g.gunlukle ?? (() => {});
  const d = oyunDogrula(g.oyun);
  if (!d.ok) throw new Error(d.hata);
  adim(`Oyun klasörü doğrulandı: ${g.oyun}`);
  const acik = acikSurecler(g.surecler);
  if (acik.length) throw new Error(`Oyun açık (${acik.join(', ')}). Oyunu kapatıp yeniden deneyin.`);
  const hedef = join(d.paks, YAMA_PAK_ADI);
  const once = hedefDurumu(hedef);
  if (once.durum === 'yabanci') throw new Error(`"${hedef}" bu yamaya ait değil (${once.neden ?? 'Türkçe yama dosyası değil'}). Üzerine yazılmadı.`);
  adim(once.durum === 'bizim' ? 'Eski yama bulundu, güncellenecek.' : 'Hedefte başka dosya yok.');
  adim('Oyunun İngilizce metni okunuyor…');
  const kaynak = g.kaynakUret();
  if (g.beklenenParmakIzi && kaynak.parmakIzi !== g.beklenenParmakIzi) {
    throw new Error('Bu oyun sürümü için yama henüz hazır değil (oyunun metni sınanan sürümle aynı değil). Hiçbir şey kurulmadı.');
  }
  adim('Oyun sürümü yamayla uyumlu.');
  adim('Türkçe yama paketi üretiliyor ve doğrulanıyor…');
  const uretilen = g.pakUret();
  const sha = sha256Dosya(uretilen);
  if (g.kuru) return { kuru: true, sha256: sha, hedef, build: kaynak.build ?? null };
  const gecici = `${hedef}.kurulum-gecici`;
  try {
    (g.kopyala ?? copyFileSync)(uretilen, gecici);
    if (sha256Dosya(gecici) !== sha) throw new Error('Kopyalanan dosya üretilenle aynı değil (disk hatası olabilir). Hiçbir şey değişmedi.');
    renameSync(gecici, hedef);
  } finally { try { if (existsSync(gecici)) rmSync(gecici); } catch { /* geçici dosya silinemedi */ } }
  if (sha256Dosya(hedef) !== sha) throw new Error('Yerine konan dosya doğrulanamadı.');
  kayitYaz(g.kayitKlasoru, { sha256: sha, build: kaynak.build ?? null, tarih: new Date().toISOString(), hedef });
  adim(`Yama kuruldu: ${hedef}`);
  return { kuru: false, sha256: sha, hedef, build: kaynak.build ?? null };
}

/**
 * Kaldırır: yalnız bizim dosyayı. Kayıt varsa dosyanın SHA256'sı kayıttakiyle AYNI olmalı (farklıysa dosya sonradan değişmiş,
 * silinmez); kayıt yoksa dosya yapısı bizimki olmalı (Türkçe locres yolu). Döner: { silindi: bool, neden }.
 */
export function kaldir(g) {
  const adim = g.gunlukle ?? (() => {});
  const d = oyunDogrula(g.oyun);
  if (!d.ok) throw new Error(d.hata);
  const acik = acikSurecler(g.surecler);
  if (acik.length) throw new Error(`Oyun açık (${acik.join(', ')}). Oyunu kapatıp yeniden deneyin.`);
  const hedef = join(d.paks, YAMA_PAK_ADI);
  const durum = hedefDurumu(hedef);
  if (durum.durum === 'yok') { adim('Yama zaten kurulu değil.'); return { silindi: false, neden: 'kurulu değil' }; }
  if (durum.durum === 'yabanci') throw new Error(`"${hedef}" bu yamaya ait değil (${durum.neden ?? 'Türkçe yama dosyası değil'}). Silinmedi.`);
  const kayit = kayitOku(g.kayitKlasoru);
  if (kayit && !kayit.bozuk && sha256Dosya(hedef) !== kayit.sha256) {
    throw new Error('Yama dosyası kurulumdan sonra değiştirilmiş (kayıttaki SHA256 ile aynı değil). Güvenlik için silinmedi.');
  }
  rmSync(hedef);
  if (existsSync(hedef)) throw new Error('Yama dosyası silinemedi.');
  try { rmSync(join(g.kayitKlasoru, 'kurulum.json'), { force: true }); } catch { /* kayıt silinemedi: zararsız */ }
  adim('Yama kaldırıldı. Oyun özgün haline döndü.');
  return { silindi: true, neden: 'silindi' };
}

/** Durum özeti (yalnız okur): { oyun, buildid, hedef, hedefDurumu, kayit }. */
export function durum(oyun, kayitKlasoru) {
  const d = oyunDogrula(oyun);
  if (!d.ok) return { ok: false, hata: d.hata };
  const hedef = join(d.paks, YAMA_PAK_ADI);
  const hd = hedefDurumu(hedef);
  const kayit = kayitOku(kayitKlasoru);
  return { ok: true, hedef, hedefDurumu: hd.durum, boyut: hd.durum === 'yok' ? 0 : statSync(hedef).size, kayit };
}
