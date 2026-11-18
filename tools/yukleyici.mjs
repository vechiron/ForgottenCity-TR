// Yükleyicinin komut satırı: Windows penceresi (yukleyici/Yukle.cs) bunu çağırır, elle de koşulur.
//
// Kullanım:
//   node tools/yukleyici.mjs bul [--oyun <klasör>]       Steam kopyasını bulur (ya da verilen klasörü doğrular)
//   node tools/yukleyici.mjs durum [--oyun <klasör>]     yama kurulu mu
//   node tools/yukleyici.mjs kur [--oyun <klasör>] [--kuru]     kurar (--kuru: üretir ve doğrular, oyuna yazmaz)
//   node tools/yukleyici.mjs kaldir [--oyun <klasör>]    kaldırır
//   node tools/yukleyici.mjs parmak-izi-yaz [--oyun <klasör>]   (geliştirici) oyunun bu sürümünü `ceviri/oyun-parmak-izi.json`a yazar
//   node tools/yukleyici.mjs --sina                      kapı: sahte oyun klasörleriyle kur/kaldır/bul sınamaları
// Çıktı satırları (pencere bunları okur): OYUN <yol> · DURUM <kurulu|eski|kurulu-degil|yabanci> · ADIM <metin> · HATA <metin> · BITTI <metin>
// Çıkış: 0 tamam · 1 hata (hiçbir şey kurulmadı/silinmedi) · 2 oyun bulunamadı ya da kullanım hatası
//
// Ortam: FC_KAYIT (kayıt klasörü, varsayılan %LOCALAPPDATA%\ForgottenCityTR), FC_OYUN (oyun klasörü).
// Bu araç şunu GÖREMEZ: lib/yukleyici.mjs başındaki liste.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { durum, kaldir, kur, oyunDogrula, sha256Bayt, steamOyunlari } from './lib/yukleyici.mjs';

const KOK = fileURLToPath(new URL('..', import.meta.url));
const arg = process.argv.slice(2);
const komut = arg.find(a => !a.startsWith('--'));
const deger = (ad) => { const i = arg.indexOf(ad); return i >= 0 ? arg[i + 1] : undefined; };
const KAYIT = process.env.FC_KAYIT || join(process.env.LOCALAPPDATA || tmpdir(), 'ForgottenCityTR');
const PARMAK_YOLU = join(KOK, 'ceviri', 'oyun-parmak-izi.json');

const yaz = (onek, metin) => console.log(`${onek} ${metin}`);

/** Steam kurulum klasörleri: kayıt defteri + bilinen yerler. */
function steamKokleri() {
  const adaylar = [];
  for (const [anahtar, ad] of [['HKCU\\Software\\Valve\\Steam', 'SteamPath'], ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'], ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath']]) {
    const r = spawnSync('reg', ['query', anahtar, '/v', ad], { encoding: 'utf8', windowsHide: true });
    const m = r.status === 0 && r.stdout.match(new RegExp(`${ad}\\s+REG_SZ\\s+(.+)`));
    if (m) adaylar.push(m[1].trim().replace(/\//g, '\\'));
  }
  adaylar.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
  return [...new Set(adaylar)];
}

function calisanSurecler() {
  const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('Çalışan programlar listelenemedi (tasklist): oyunun kapalı olduğu doğrulanamadı, güvenlik için durduruldu.');
  return r.stdout.split(/\r?\n/).map(s => s.match(/^"([^"]+)"/)?.[1]).filter(Boolean);
}

function oyunuBul() {
  const elle = deger('--oyun') ?? process.env.FC_OYUN;
  if (elle) {
    const d = oyunDogrula(elle);
    if (!d.ok) { yaz('HATA', d.hata); process.exit(2); }
    return { oyun: elle, buildid: null };
  }
  const bulunan = steamOyunlari(steamKokleri());
  if (!bulunan.length) { yaz('DURUM', 'bulunamadi'); yaz('HATA', 'The Forgotten City Steam kütüphanelerinde bulunamadı. Oyun klasörünü elle gösterin.'); process.exit(2); }
  return bulunan[0];
}

/** `ceviri-kaynak` çıktısından oyun sürümünün parmak izi: eşleşme tablosunun SHA256'sı (Steam yapı numarasından bağımsız, oyunun metnine bağlı). */
export function parmakIzi(indeksYolu) {
  const i = JSON.parse(readFileSync(indeksYolu, 'utf8'));
  return { parmakIzi: sha256Bayt(Buffer.from(JSON.stringify(i.eslesme), 'utf8')), build: i.build ?? null };
}

function alt(betik, args) {
  const r = spawnSync(process.execPath, [join(KOK, 'tools', betik), ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${betik} başarısız (çıkış ${r.status}): ${(r.stderr || r.stdout || '').trim().split(/\r?\n/).slice(-4).join(' | ')}`);
  return r;
}

function beklenenParmakIzi() {
  if (!existsSync(PARMAK_YOLU)) throw new Error(`${PARMAK_YOLU} yok: yükleyici paketi eksik, güvenlik için kurulmadı.`);
  const p = JSON.parse(readFileSync(PARMAK_YOLU, 'utf8'));
  if (typeof p.parmakIzi !== 'string' || p.parmakIzi.length !== 64) throw new Error(`${PARMAK_YOLU} bozuk`);
  return p.parmakIzi;
}

function calistir() {
  if (komut === 'durum' || komut === 'bul') {
    const { oyun, buildid } = oyunuBul();
    yaz('OYUN', oyun);
    if (buildid) yaz('ADIM', `Steam yapı numarası: ${buildid}`);
    const d = durum(oyun, KAYIT);
    if (!d.ok) { yaz('HATA', d.hata); process.exit(2); }
    yaz('DURUM', d.hedefDurumu === 'bizim' ? 'kurulu' : d.hedefDurumu === 'yok' ? 'kurulu-degil' : 'yabanci');
    return;
  }
  if (komut === 'kur' || komut === 'kaldir' || komut === 'parmak-izi-yaz') {
    const { oyun } = oyunuBul();
    yaz('OYUN', oyun);
    const gunlukle = (m) => yaz('ADIM', m);
    if (komut === 'kaldir') { const s = kaldir({ oyun, surecler: calisanSurecler(), kayitKlasoru: KAYIT, gunlukle }); yaz('BITTI', s.silindi ? 'Yama kaldırıldı.' : 'Yama zaten kurulu değildi.'); return; }
    const gecici = mkdtempSync(join(tmpdir(), 'fctr-'));
    try {
      const kaynakKlasoru = join(gecici, 'kaynak');
      let son = null;
      const kaynakUret = () => { alt('ceviri-kaynak.mjs', ['--oyun', oyun, '--cikti', kaynakKlasoru]); son = parmakIzi(join(kaynakKlasoru, 'indeks.json')); return son; };
      if (komut === 'parmak-izi-yaz') {
        const k = kaynakUret();
        writeFileSync(PARMAK_YOLU, `${JSON.stringify({ parmakIzi: k.parmakIzi, build: k.build, not: 'oyunun sınanan sürümünün eşleşme tablosu SHA256; yükleyici farklı sürüme kurmayı reddeder (tools/yukleyici.mjs parmak-izi-yaz)' }, null, 2)}\n`);
        yaz('BITTI', `parmak izi yazıldı: ${k.parmakIzi} (build ${k.build})`); return;
      }
      const pakUret = () => { alt('yama-uret.mjs', ['--oyun', oyun, '--kaynak', kaynakKlasoru, '--cikti', join(gecici, 'yama')]); return join(gecici, 'yama', 'pakchunk0-WindowsNoEditor_P.pak'); };
      const s = kur({ oyun, surecler: calisanSurecler(), kayitKlasoru: KAYIT, beklenenParmakIzi: beklenenParmakIzi(), kaynakUret, pakUret, gunlukle, kuru: arg.includes('--kuru') });
      yaz('BITTI', s.kuru ? `Deneme tamam (oyuna yazılmadı). Pak SHA256: ${s.sha256}` : 'Türkçe yama kuruldu. Oyunu açabilirsiniz.');
    } finally { rmSync(gecici, { recursive: true, force: true }); }
    return;
  }
  console.error('Kullanım: node tools/yukleyici.mjs <bul|durum|kur|kaldir> [--oyun <klasör>] [--kuru]');
  process.exit(2);
}

if (arg.includes('--sina')) {
  const { sina } = await import('./yukleyici-sina.mjs');
  sina();
} else {
  try { calistir(); } catch (e) { yaz('HATA', e.message); process.exit(1); }
}
