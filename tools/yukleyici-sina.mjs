// `node tools/yukleyici.mjs --sina`: yükleyici çekirdeğinin kapısı. GERÇEK oyuna dokunmaz: sahte Steam klasörleri
// (appmanifest, libraryfolders.vdf, küçük sahte paklar) geçici klasörde kurulur.
//
// Bu sınama şunu GÖREMEZ: gerçek `ceviri-kaynak` ve `yama-uret` akışını (bunlar `kaynakUret`/`pakUret` yerine sahte işlevlerle
// değiştirilir; gerçek akış `yukleyici.mjs kur --kuru` ile elle sınanır) · gerçek tasklist çıktısını · Windows pencere kodunu ·
// gerçek Steam kütüphanesinin düzenini (yalnız bu makinede görülen vdf biçimi) · çok kullanıcılı bilgisayarları.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pakYaz } from './lib/pak.mjs';
import { yamaPakKur, YAMA_PAK_ADI } from './lib/yama.mjs';
import { acikSurecler, hedefDurumu, kaldir, kayitOku, kur, manifestOku, oyunDogrula, sha256Bayt, sha256Dosya, steamOyunlari, vdfKutuphaneleri } from './lib/yukleyici.mjs';

export function sina() {
  let basarisiz = 0, say = 0;
  const dene = (ad, kosul) => { say++; if (!kosul) basarisiz++; console.log(`${kosul ? 'TAMAM    ' : 'BAŞARISIZ'}  ${ad}`); };
  const firlatir = (f, desen) => { try { f(); return false; } catch (e) { return desen ? desen.test(e.message) : true; } };
  const gecici = mkdtempSync(join(tmpdir(), 'fctr-sina-'));
  try {
    const OYUN_PAK = pakYaz({ dosyalar: [{ yol: 'ModernStoryteller01/Content/Localization/Game/en/Game.locres', veri: Buffer.from('ornek') }] });
    const BIZIM_PAK = yamaPakKur(Buffer.from('turkce-locres-ornek'));
    const BASKA_PAK = pakYaz({ dosyalar: [{ yol: 'ModernStoryteller01/Content/Baska/Mod.uasset', veri: Buffer.from('baska bir mod') }] });
    const ESKI_BIZIM = yamaPakKur(Buffer.from('eski-surum'));

    /** Sahte Steam kütüphanesinde oyun klasörü kurar. Döner: oyun yolu. */
    const oyunKur = (kok, { pakVar = true, yamaIcerik = null } = {}) => {
      const oyun = join(kok, 'steamapps', 'common', 'The Forgotten City');
      const paks = join(oyun, 'ModernStoryteller01', 'Content', 'Paks');
      mkdirSync(paks, { recursive: true });
      if (pakVar) writeFileSync(join(paks, 'pakchunk0-WindowsNoEditor.pak'), OYUN_PAK);
      if (yamaIcerik) writeFileSync(join(paks, YAMA_PAK_ADI), yamaIcerik);
      writeFileSync(join(kok, 'steamapps', 'appmanifest_874260.acf'), `"AppState"\n{\n\t"appid"\t\t"874260"\n\t"installdir"\t\t"The Forgotten City"\n\t"buildid"\t\t"1234"\n}\n`);
      return oyun;
    };

    // --- saf ayrıştırıcılar ---
    const vdf = `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t\t"label"\t\t""\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}\n`;
    dene('vdf: iki kütüphane, \\\\ → \\', JSON.stringify(vdfKutuphaneleri(vdf)) === JSON.stringify(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']));
    dene('vdf: boş metin boş liste', vdfKutuphaneleri('').length === 0);
    dene('manifest: installdir ve buildid', JSON.stringify(manifestOku('"installdir"\t"The Forgotten City"\n"buildid"\t"9300715"')) === JSON.stringify({ installdir: 'The Forgotten City', buildid: '9300715' }));
    dene('manifest: alan yoksa null', manifestOku('"appid" "1"').installdir === null);

    // --- oyun doğrulama ---
    const bos = join(gecici, 'bos'); mkdirSync(bos);
    dene('doğrula: ilgisiz klasör reddedilir', !oyunDogrula(bos).ok);
    dene('doğrula: olmayan klasör reddedilir', !oyunDogrula(join(gecici, 'yok')).ok);
    const kokA = join(gecici, 'steamA'); mkdirSync(join(kokA, 'steamapps'), { recursive: true });
    const oyunA = oyunKur(kokA);
    dene('doğrula: sahte oyun klasörü tamam', oyunDogrula(oyunA).ok);
    const kokPaksiz = join(gecici, 'steamP'); mkdirSync(join(kokPaksiz, 'steamapps'), { recursive: true });
    const oyunPaksiz = oyunKur(kokPaksiz, { pakVar: false });
    dene('doğrula: pak dosyası olmayan Paks klasörü reddedilir', !oyunDogrula(oyunPaksiz).ok);
    const kokYalnizYama = join(gecici, 'steamY'); mkdirSync(join(kokYalnizYama, 'steamapps'), { recursive: true });
    const oyunYalnizYama = oyunKur(kokYalnizYama, { pakVar: false, yamaIcerik: BIZIM_PAK });
    dene('doğrula: yalnız _P.pak olan klasör oyun sayılmaz', !oyunDogrula(oyunYalnizYama).ok);

    // --- Steam bulma ---
    dene('bul: tek kökte bulunur', steamOyunlari([kokA]).length === 1 && steamOyunlari([kokA])[0].buildid === '1234');
    const kokB = join(gecici, 'steamB'); mkdirSync(join(kokB, 'steamapps'), { recursive: true });
    const kutuphane2 = join(gecici, 'kutuphane2'); mkdirSync(join(kutuphane2, 'steamapps'), { recursive: true });
    const oyunK2 = oyunKur(kutuphane2);
    writeFileSync(join(kokB, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"1"\n\t{\n\t\t"path"\t\t"${kutuphane2.replace(/\\/g, '\\\\')}"\n\t}\n}\n`);
    const b = steamOyunlari([kokB]);
    dene('bul: ikinci kütüphane klasöründeki oyun vdf üzerinden bulunur', b.length === 1 && b[0].oyun === oyunK2);
    dene('bul: aynı klasör iki yoldan gelse tek kez döner', steamOyunlari([kokA, kokA, join(kokA)]).length === 1);
    const kokBuyuk = join(gecici, 'steamBuyuk'); mkdirSync(join(kokBuyuk, 'steamapps'), { recursive: true }); oyunKur(kokBuyuk);
    const ters = String.fromCharCode(92);
    const buyukYol = kokBuyuk.toUpperCase().split(ters).join(ters + ters);
    const sat = String.fromCharCode(10), tab = String.fromCharCode(9);
    writeFileSync(join(kokBuyuk, 'steamapps', 'libraryfolders.vdf'), ['"libraryfolders"', '{', tab + '"0"', tab + '{', tab + tab + '"path"' + tab + tab + '"' + buyukYol + '"', tab + '}', '}', ''].join(sat));
    dene('bul: vdf kökü başka harf büyüklüğüyle yazsa da (Steam bunu yapar) oyun tek kez döner', steamOyunlari([kokBuyuk]).length === 1);
    dene('bul: Steam yoksa (olmayan kök, boş kök) boş liste', steamOyunlari([join(gecici, 'yok'), null, bos]).length === 0);
    const kokBozuk = join(gecici, 'steamBozuk'); mkdirSync(join(kokBozuk, 'steamapps'), { recursive: true });
    writeFileSync(join(kokBozuk, 'steamapps', 'libraryfolders.vdf'), '\u0000\u0001 bozuk {{{');
    const oyunBozuk = oyunKur(kokBozuk);
    dene('bul: bozuk libraryfolders.vdf kökü taramaya engel olmaz', steamOyunlari([kokBozuk]).length === 1 && steamOyunlari([kokBozuk])[0].oyun === oyunBozuk);
    const kokYanlisAd = join(gecici, 'steamYanlis'); mkdirSync(join(kokYanlisAd, 'steamapps'), { recursive: true });
    writeFileSync(join(kokYanlisAd, 'steamapps', 'appmanifest_874260.acf'), '"AppState"\n{\n\t"installdir"\t"Olmayan Klasor"\n}\n');
    dene('bul: manifest var ama oyun klasörü yoksa bulunmuş sayılmaz', steamOyunlari([kokYanlisAd]).length === 0);

    // --- süreç ---
    dene('süreç: oyun adı (büyük/küçük harf fark etmez) açık sayılır', acikSurecler(['explorer.exe', 'modernstoryteller01-win64-shipping.exe']).length === 1);
    dene('süreç: ilgisiz süreçler açık sayılmaz', acikSurecler(['explorer.exe', 'node.exe']).length === 0);

    // --- kurulum ---
    const PAK_URETILEN = yamaPakKur(Buffer.from('yeni-turkce-locres'));
    const URETILEN_SHA = sha256Bayt(PAK_URETILEN);
    const kayit = join(gecici, 'kayit');
    const olaylar = [];
    const baslat = (oyun, ek = {}) => {
      const uretilenDosya = join(gecici, `uretilen-${olaylar.length}.pak`);
      olaylar.push(1);
      return {
        oyun, surecler: ['explorer.exe'], kayitKlasoru: kayit, beklenenParmakIzi: 'AAAA',
        kaynakUret: () => ({ parmakIzi: 'AAAA', build: '1234' }),
        pakUret: () => { writeFileSync(uretilenDosya, PAK_URETILEN); return uretilenDosya; },
        ...ek,
      };
    };
    const hedefYolu = (oyun) => join(oyun, 'ModernStoryteller01', 'Content', 'Paks', YAMA_PAK_ADI);
    const paksListe = (oyun) => readdirSync(join(oyun, 'ModernStoryteller01', 'Content', 'Paks')).sort().join(',');

    // 1) temiz kurulum
    let s = kur(baslat(oyunA));
    dene('kur: temiz oyunda kurulur, hedef dosya üretilenle bayt eşit', existsSync(hedefYolu(oyunA)) && sha256Dosya(hedefYolu(oyunA)) === URETILEN_SHA && s.sha256 === URETILEN_SHA);
    dene('kur: kayıt dosyası SHA256 ve hedefi içerir', kayitOku(kayit)?.sha256 === URETILEN_SHA && kayitOku(kayit)?.hedef === hedefYolu(oyunA));
    dene('kur: oyunun kendi pakına ve yan dosyalara dokunmaz, geçici dosya kalmaz', paksListe(oyunA) === `pakchunk0-WindowsNoEditor.pak,${YAMA_PAK_ADI}` && sha256Dosya(join(oyunA, 'ModernStoryteller01', 'Content', 'Paks', 'pakchunk0-WindowsNoEditor.pak')) === sha256Bayt(OYUN_PAK));
    dene('hedef durumu: kurulan dosya "bizim"', hedefDurumu(hedefYolu(oyunA)).durum === 'bizim');
    // 2) ikinci kez (idempotent)
    s = kur(baslat(oyunA));
    dene('kur: ikinci kez kurmak hata vermez, sonuç aynı', sha256Dosya(hedefYolu(oyunA)) === URETILEN_SHA && s.sha256 === URETILEN_SHA);
    // 3) eski sürüm güncellenir
    writeFileSync(hedefYolu(oyunA), ESKI_BIZIM);
    kur(baslat(oyunA));
    dene('kur: eski sürüm yamanın üzerine yeni sürüm yazılır', sha256Dosya(hedefYolu(oyunA)) === URETILEN_SHA);

    // kopya bozulursa (disk hatası taklidi)
    const oyunKopya = oyunKur((() => { const k = join(gecici, 'steamK'); mkdirSync(join(k, 'steamapps'), { recursive: true }); return k; })());
    dene('kur: kopya üretilenle aynı değilse reddedilir, hedef oluşmaz, geçici dosya kalmaz',
      firlatir(() => kur(baslat(oyunKopya, { kopyala: (a, b) => writeFileSync(b, Buffer.from('bozuk kopya')) })), /üretilenle aynı değil/) && paksListe(oyunKopya) === 'pakchunk0-WindowsNoEditor.pak');
    // 4) oyun açık
    const kokC = join(gecici, 'steamC'); mkdirSync(join(kokC, 'steamapps'), { recursive: true });
    const oyunC = oyunKur(kokC);
    dene('kur: oyun açıkken reddedilir, hedefe dokunulmaz', firlatir(() => kur(baslat(oyunC, { surecler: ['ModernStoryteller01-Win64-Shipping.exe'] })), /Oyun açık/) && !existsSync(hedefYolu(oyunC)));
    dene('kur: başlatıcı süreç açıkken de reddedilir', firlatir(() => kur(baslat(oyunC, { surecler: ['ModernStoryteller01.exe'] })), /Oyun açık/) && !existsSync(hedefYolu(oyunC)));
    // 5) parmak izi
    let uretildi = false;
    dene('kur: oyun sürümü farklıysa (parmak izi) reddedilir, pak üretimine bile geçilmez, hedef yok',
      firlatir(() => kur(baslat(oyunC, { kaynakUret: () => ({ parmakIzi: 'BBBB', build: '9999' }), pakUret: () => { uretildi = true; return ''; } })), /henüz hazır değil/) && !uretildi && !existsSync(hedefYolu(oyunC)));
    // 6) yabancı dosya
    writeFileSync(hedefYolu(oyunC), BASKA_PAK);
    dene('kur: hedefte yabancı dosya varsa reddedilir, baytları değişmez', firlatir(() => kur(baslat(oyunC)), /bu yamaya ait değil/) && sha256Dosya(hedefYolu(oyunC)) === sha256Bayt(BASKA_PAK));
    writeFileSync(hedefYolu(oyunC), Buffer.alloc(0));
    dene('kur: hedef 0 baytlık/bozuk dosyaysa yabancı sayılır, üzerine yazılmaz', firlatir(() => kur(baslat(oyunC)), /bu yamaya ait değil/) && readFileSync(hedefYolu(oyunC)).length === 0);
    rmSync(hedefYolu(oyunC));
    // 7) kuru koşum
    s = kur(baslat(oyunC, { kuru: true }));
    dene('kur --kuru: üretir ve doğrular ama oyuna yazmaz, kayıt yazmaz', s.kuru === true && !existsSync(hedefYolu(oyunC)) && kayitOku(kayit)?.hedef === hedefYolu(oyunA));
    // 8) üretim hata verirse
    dene('kur: pak üretimi hata verirse hedef oluşmaz, geçici dosya kalmaz', firlatir(() => kur(baslat(oyunC, { pakUret: () => { throw new Error('kapı tutmadı'); } })), /kapı tutmadı/) && paksListe(oyunC) === 'pakchunk0-WindowsNoEditor.pak');
    dene('kur: kaynak üretimi hata verirse hedef oluşmaz', firlatir(() => kur(baslat(oyunC, { kaynakUret: () => { throw new Error('okunamadı'); } })), /okunamadı/) && paksListe(oyunC) === 'pakchunk0-WindowsNoEditor.pak');
    dene('kur: oyun klasörü geçersizse reddedilir', firlatir(() => kur(baslat(bos)), /Paks klasörü yok/));
    // 9) bozuk kayıt dosyası kurulumu engellemez
    mkdirSync(kayit, { recursive: true }); writeFileSync(join(kayit, 'kurulum.json'), '{{bozuk');
    dene('kayıt: bozuk kayıt dosyası "bozuk" olarak okunur, çökmez', kayitOku(kayit)?.bozuk === true);
    kur(baslat(oyunC));
    dene('kur: bozuk kayıt dosyası varken kurulur ve kaydı yeniler', sha256Dosya(hedefYolu(oyunC)) === URETILEN_SHA && kayitOku(kayit)?.sha256 === URETILEN_SHA);

    // --- kaldırma ---
    const kal = (oyun, ek = {}) => kaldir({ oyun, surecler: ['explorer.exe'], kayitKlasoru: kayit, ...ek });
    dene('kaldır: oyun açıkken reddedilir, dosya yerinde', firlatir(() => kal(oyunC, { surecler: ['ModernStoryteller01-Win64-Shipping.exe'] }), /Oyun açık/) && existsSync(hedefYolu(oyunC)));
    // kayıttaki SHA ile dosya farklıysa
    const oncekiKayit = kayitOku(kayit);
    writeFileSync(hedefYolu(oyunC), ESKI_BIZIM);
    dene('kaldır: kayıttaki SHA256 ile dosya farklıysa (sonradan değişmiş) silinmez', firlatir(() => kal(oyunC), /değiştirilmiş/) && existsSync(hedefYolu(oyunC)));
    writeFileSync(hedefYolu(oyunC), PAK_URETILEN);
    let k = kal(oyunC);
    dene('kaldır: kurulu yama silinir, oyunun kendi pakı yerinde, kayıt silinir', k.silindi && paksListe(oyunC) === 'pakchunk0-WindowsNoEditor.pak' && kayitOku(kayit) === null && !!oncekiKayit);
    k = kal(oyunC);
    dene('kaldır: kurulu değilken hata vermez, hiçbir şey silmez', !k.silindi && paksListe(oyunC) === 'pakchunk0-WindowsNoEditor.pak');
    writeFileSync(hedefYolu(oyunC), BASKA_PAK);
    dene('kaldır: yabancı dosya silinmez', firlatir(() => kal(oyunC), /bu yamaya ait değil/) && sha256Dosya(hedefYolu(oyunC)) === sha256Bayt(BASKA_PAK));
    writeFileSync(hedefYolu(oyunC), ESKI_BIZIM);
    k = kal(oyunC);
    dene('kaldır: kayıt yokken bizim yapıdaki dosya silinir', k.silindi && !existsSync(hedefYolu(oyunC)));
    mkdirSync(kayit, { recursive: true }); writeFileSync(join(kayit, 'kurulum.json'), 'bozuk');
    writeFileSync(hedefYolu(oyunC), ESKI_BIZIM);
    k = kal(oyunC);
    dene('kaldır: bozuk kayıt varken bizim yapıdaki dosya silinir (kayıt yok sayılır)', k.silindi && !existsSync(hedefYolu(oyunC)));
    dene('kaldır: oyun klasörü geçersizse reddedilir', firlatir(() => kal(bos), /Paks klasörü yok/));
  } finally { rmSync(gecici, { recursive: true, force: true }); }
  console.log(basarisiz ? `\n${basarisiz}/${say} sınama başarısız` : `\n${say} sınama, hepsi tamam`);
  process.exit(basarisiz ? 1 : 0);
}
