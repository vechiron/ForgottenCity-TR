// Yükleyici paketini kurar: `dist/ForgottenCityTR-Yukleyici/` (git DIŞI) ve ona `.zip`. İçindekiler:
//   Yukle.exe (Windows'un kendi csc.exe'siyle derlenir) · node.exe (bu makinenin Node'u kopyalanır) ·
//   tools/ (yalnız yükleyicinin ve üretimin ihtiyacı olanlar) · ceviri/ (Türkçe çeviri + başlık listesi + oyun parmak izi) ·
//   OKU.txt · LICENSE-MIT.txt · LICENSE-CEVIRI.txt
// OYUNDAN TÜREYEN HİÇBİR ŞEY KONMAZ (hazır pak yok, İngilizce kaynak yok): pak kullanıcının bilgisayarında üretilir.
//
// Kullanım: node tools/yukleyici-paketle.mjs [--zip-yok]
// Çıkış: 0 tamam · 1 hata. Paket sonunda KENDİ KOPYASINDAN `yukleyici.mjs kur --kuru` koşulur (gerçek oyuna yazmaz): paketin
// eksik dosyası varsa burada patlar, kullanıcıda değil.
//
// Bu araç şunu GÖREMEZ: Node'un lisans metninin node.exe ile birlikte dağıtım gerekliliğini (README'de atıf var, resmî metin pakete
// konmadı: bu makinede yok, ağdan indirilmedi) · SmartScreen/virüs yazılımı tepkisini · başka makinede çalışmayı.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = fileURLToPath(new URL('..', import.meta.url));
const PAKET = join(KOK, 'dist', 'ForgottenCityTR-Yukleyici');
const hata = (m) => { console.error(`HATA: ${m}`); process.exit(1); };

rmSync(PAKET, { recursive: true, force: true });
mkdirSync(join(PAKET, 'tools', 'lib'), { recursive: true });
mkdirSync(join(PAKET, 'ceviri'), { recursive: true });

// 1) pencere
const csc = ['C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', 'C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe'].find(existsSync);
if (!csc) hata('csc.exe bulunamadı (.NET Framework 4 yok)');
const d = spawnSync(csc, ['/nologo', '/target:winexe', '/codepage:65001', '/optimize+', `/out:${join(PAKET, 'Yukle.exe')}`,
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', join(KOK, 'yukleyici', 'Yukle.cs')], { encoding: 'utf8' });
if (d.status !== 0) hata(`derleme başarısız:\n${d.stdout}${d.stderr}`);

// 2) Node
copyFileSync(process.execPath, join(PAKET, 'node.exe'));

// 3) araçlar: yalnız gerekenler; hangi dosyanın gerektiği import zincirinden değil, bu listeden (paket sonundaki kuru koşum eksiği yakalar)
for (const a of ['yukleyici.mjs', 'ceviri-kaynak.mjs', 'yama-uret.mjs']) copyFileSync(join(KOK, 'tools', a), join(PAKET, 'tools', a));
for (const a of readdirSync(join(KOK, 'tools', 'lib')).filter(x => x.endsWith('.mjs'))) copyFileSync(join(KOK, 'tools', 'lib', a), join(PAKET, 'tools', 'lib', a));
// yama-uret.mjs `--sina` için yukleyici-sina'yı dinamik içe aktarır: pakette gerekmez ama yukleyici.mjs `--sina`da çağırır; kopyalanır (küçük)
copyFileSync(join(KOK, 'tools', 'yukleyici-sina.mjs'), join(PAKET, 'tools', 'yukleyici-sina.mjs'));

// 4) çeviri: Türkçe parçalar + başlık listesi + parmak izi (İngilizce kaynak YOK)
for (const a of readdirSync(join(KOK, 'ceviri')).filter(x => /^parca-\d+\.json$/.test(x) || x === 'baslik-yazi-tipi.json' || x === 'oyun-parmak-izi.json')) copyFileSync(join(KOK, 'ceviri', a), join(PAKET, 'ceviri', a));

// 5) belgeler
for (const [kaynak, hedef] of [['yukleyici/OKU.txt', 'OKU.txt'], ['LICENSE', 'LICENSE-MIT.txt'], ['LICENSE-CEVIRI', 'LICENSE-CEVIRI.txt']]) {
  if (existsSync(join(KOK, kaynak))) copyFileSync(join(KOK, kaynak), join(PAKET, hedef));
  else console.log(`uyarı: ${kaynak} yok, pakete konmadı`);
}

// 6) oyundan türeyen dosya var mı (kapı): .pak, ceviri/kaynak, .locres
const tara = (k) => readdirSync(k, { withFileTypes: true }).flatMap(e => e.isDirectory() ? tara(join(k, e.name)) : [join(k, e.name)]);
const dosyalar = tara(PAKET).map(y => y.slice(PAKET.length + 1).replace(/\\/g, '/'));
const yasak = dosyalar.filter(y => /\.(pak|locres|uasset|uexp)$/i.test(y) || y.startsWith('ceviri/kaynak/'));
if (yasak.length) hata(`pakette oyundan türeyen dosya var: ${yasak.join(', ')}`);

// 7) paketin kendi kopyasından kuru koşum (gerçek oyuna yazmaz)
const k = spawnSync(join(PAKET, 'node.exe'), [join(PAKET, 'tools', 'yukleyici.mjs'), 'kur', '--kuru'], { encoding: 'utf8', cwd: PAKET });
if (k.status !== 0) hata(`paketten kuru koşum başarısız (çıkış ${k.status}):\n${k.stdout}${k.stderr}`);
console.log(k.stdout.trim().split(/\r?\n/).slice(-2).join('\n'));

// 8) zip
if (!process.argv.includes('--zip-yok')) {
  const zip = join(KOK, 'dist', 'ForgottenCityTR-Yukleyici.zip');
  rmSync(zip, { force: true });
  const z = spawnSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${PAKET}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal`], { encoding: 'utf8' });
  if (z.status !== 0 || !existsSync(zip)) hata(`zip başarısız: ${z.stderr}`);
  console.log(`zip: ${zip} (${(statSync(zip).size / 1048576).toFixed(1)} MB)`);
}
console.log(`paket: ${PAKET} · ${dosyalar.length} dosya`);
