// Çeviri kaynağını üretir: oyunun İngilizce metnini, geçtiği varlığa göre gruplanmış (konuşmalar sırasıyla) ve
// konuşma sınırında bölünmüş parçalar hâlinde `ceviri/kaynak/` altına yazar. YALNIZCA OKUR (oyun); yazdığı tek yer
// `ceviri/kaynak/` (git DIŞI: İngilizce oyun metni depoya girmez, .gitignore).
//
// Kullanım:
//   node tools/ceviri-kaynak.mjs [--oyun <klasör>] [--parca <N, varsayılan 12>] [--cikti <klasör>]
//   node tools/ceviri-kaynak.mjs --sina     karşı test: sentetik girdi + gerçek oyun; araç bilerek bozulmuş girdiyi yakalıyor mu
// Çıktı: <cikti>/parca-NN.json (ajana verilir) · <cikti>/indeks.json (kimlik → ad alanı+anahtar, yamayı yazarken lazım)
// Ajanın çıktısı: `ceviri/parca-NN.json`, { "<id>": "Türkçe" } (denetleyici: tools/ceviri-denetle.mjs).
// Çıkış: 0 tamam · 1 ölçüm tutarsız (kimlikler eksik/yinelenen) · 2 kullanım hatası
//
// Bu araç şunu GÖREMEZ: parçaların çeviri açısından iyi bölünüp bölünmediği (konuşma sınırı bir ölçüttür, anlam değil) ·
// ajanların bağlamı gerçekten kullanıp kullanmadığı · lib/baglam.mjs'nin başındaki sınırlar · aynı anahtar birden çok varlıkta
// geçiyorsa hangi bağlam grubuna konduğu (az sayıda anahtar; 2. oturumun ölçümüne göre yalnız bağlam grubunu etkiler, kimlik ve
// `indeks.json` eşlemesini etkilemez; kimlik tam-bir-kez sayımı `kimlikSorunlari`da, seçim kuralının kendisi testsiz).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { oyunPakAdlari, pakAc } from './lib/pak.mjs';
import { locresCoz } from './lib/locres.mjs';
import { anahtarKonumlari, metinGruplari, parcala, YERI_BILINMEYEN } from './lib/baglam.mjs';

const VARSAYILAN = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\The Forgotten City';
const arg = process.argv.slice(2);
const deger = (ad, yedek) => { const i = arg.indexOf(ad); return i >= 0 ? arg[i + 1] : yedek; };
const OYUN = deger('--oyun', process.env.FC_OYUN || VARSAYILAN);
const PARCA = Number(deger('--parca', 12));
const CIKTI = deger('--cikti', join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'ceviri', 'kaynak'));
const PAKLAR = join(OYUN, 'ModernStoryteller01', 'Content', 'Paks');

/** Parça dosyasının metni: her metin kendi satırında (ajan okurken satır satır görür), tamamı geçerli JSON. */
export function parcaJson(p, no, toplam) {
  const metinSayisi = p.gruplar.reduce((t, g) => t + g.metinler.length, 0);
  const gruplar = p.gruplar.map(g => `    { "ad": ${JSON.stringify(g.ad)}, "metinler": [\n${g.metinler.map(m => `      ${JSON.stringify(m)}`).join(',\n')}\n    ] }`);
  return `{\n  "parca": ${no}, "toplamParca": ${toplam}, "metinSayisi": ${metinSayisi}, "karakter": ${p.karakter},\n  "gruplar": [\n${gruplar.join(',\n')}\n  ]\n}\n`;
}

/** Kimlikler 1..N tam bir kez geçiyor mu? Döner: sorun metni dizisi (boşsa tamam). */
export function kimlikSorunlari(parcalar, beklenenToplam) {
  const sayac = new Map();
  for (const p of parcalar) for (const g of p.gruplar) for (const m of g.metinler) sayac.set(m.id, (sayac.get(m.id) ?? 0) + 1);
  const sorun = [];
  const yinelenen = [...sayac].filter(([, n]) => n > 1).length;
  let eksik = 0;
  for (let i = 1; i <= beklenenToplam; i++) if (!sayac.has(i)) eksik++;
  const fazla = [...sayac.keys()].filter(i => i < 1 || i > beklenenToplam).length;
  if (yinelenen) sorun.push(`${yinelenen} kimlik birden çok kez geçiyor`);
  if (eksik) sorun.push(`${eksik} kimlik hiçbir parçada yok`);
  if (fazla) sorun.push(`${fazla} kimlik 1..${beklenenToplam} dışında`);
  return sorun;
}

/** Oyunun paketleri; `_P.pak` ile bitenler (yama paketleri, bizimki dahil) atlanır: kaynak, yamasız İngilizce metin olmalı. */
function yuklePaket() {
  if (!existsSync(PAKLAR)) { console.error(`Oyun klasörü bulunamadı: ${OYUN}\n(--oyun <klasör> ya da FC_OYUN ile ver)`); process.exit(2); }
  return oyunPakAdlari(readdirSync(PAKLAR)).map(a => pakAc(join(PAKLAR, a)));
}

/** Oyundan parçaları kurar (yazmaz). Döner: { en, konum, grup, parcalar, hedef }. */
function kur(paketler, parcaSayisi) {
  const hepsi = paketler.flatMap(pk => pk.liste().map(g => ({ pk, g })));
  const enG = hepsi.find(({ g }) => /Localization\/Game\/en\/Game\.locres$/.test(g.yol));
  if (!enG) throw new Error('en/Game.locres bulunamadı');
  const en = locresCoz(enG.pk.icerik(enG.g));
  if (!en.tutarli) throw new Error('İngilizce locres okuması tutarsız');
  const konum = anahtarKonumlari(hepsi);
  const grup = metinGruplari(en.girisler, konum.konum);
  const toplamKar = grup.gruplar.reduce((t, g) => t + g.metinler.reduce((s, m) => s + m.en.length, 0), 0);
  const hedef = Math.ceil(toplamKar / parcaSayisi);
  return { en, konum, grup, parcalar: parcala(grup.gruplar, hedef), hedef, toplamKar };
}

function uret() {
  if (!Number.isInteger(PARCA) || PARCA < 1) { console.error('--parca pozitif tam sayı olmalı'); process.exit(2); }
  const paketler = yuklePaket();
  const k = kur(paketler, PARCA);
  paketler.forEach(p => p.kapat());
  const toplamMetin = k.grup.gruplar.reduce((t, g) => t + g.metinler.length, 0);
  console.log(`locres girişi ${k.en.girisler.length} · boş ${k.grup.bos} · çevrilecek benzersiz metin ${toplamMetin} · karakter ${k.toplamKar}`);
  console.log(`varlık grubu ${k.grup.gruplar.length} · yeri bilinmeyen/ad alanlı gruba düşen metin ${k.grup.yeriBilinmeyen} (bağlamsız; ayrı gruplar) · konumu okunamayan varlık ${k.konum.adHatalari.length}`);
  if (k.konum.adHatalari.length) console.log(`⚠ ad tablosu okunamayan varlık (ilki ${k.konum.adHatalari[0].rel}): bu varlıkların metinleri "yeri bilinmeyen"e düşmüş olabilir`);
  const sorun = kimlikSorunlari(k.parcalar, toplamMetin);
  if (sorun.length) { console.error(`ÖLÇÜM TUTARSIZ: ${sorun.join(' · ')} (dosya yazılmadı)`); process.exit(1); }
  // eslesme'deki her giriş geçerli bir kimliğe (ya da boş için 0'a) bağlı mı
  const hatali = k.grup.eslesme.filter(e => e.id < 0 || e.id > toplamMetin).length;
  if (hatali) { console.error(`ÖLÇÜM TUTARSIZ: ${hatali} giriş geçersiz kimliğe bağlı (dosya yazılmadı)`); process.exit(1); }

  mkdirSync(CIKTI, { recursive: true });
  for (const a of readdirSync(CIKTI)) if (/^parca-\d+\.json$/.test(a)) rmSync(join(CIKTI, a));   // eski bölmeden kalan parça kalmasın
  k.parcalar.forEach((p, i) => writeFileSync(join(CIKTI, `parca-${String(i + 1).padStart(2, '0')}.json`), parcaJson(p, i + 1, k.parcalar.length)));
  const acf = join(dirname(dirname(OYUN)), 'appmanifest_874260.acf');
  const build = existsSync(acf) ? ((readFileSync(acf, 'utf8').match(/"buildid"\s+"([^"]*)"/) ?? [])[1] ?? '?') : '?';
  writeFileSync(join(CIKTI, 'indeks.json'), `${JSON.stringify({ build, toplamMetin, parcaSayisi: k.parcalar.length, eslesme: k.grup.eslesme.map(e => [e.ns, e.key, e.kaynakHash, e.id]) })}\n`);
  console.log(`\nyazıldı: ${CIKTI} (build ${build}, hedef parça başına ≤ ${k.hedef} karakter)`);
  k.parcalar.forEach((p, i) => {
    const m = p.gruplar.reduce((t, g) => t + g.metinler.length, 0);
    const bilinmeyen = p.gruplar.filter(g => g.ad.startsWith('(')).length;
    console.log(`  parca-${String(i + 1).padStart(2, '0')}  ${String(m).padStart(5)} metin · ${String(p.karakter).padStart(6)} karakter · ${String(p.gruplar.length).padStart(3)} grup${bilinmeyen ? ` · yeri bilinmeyen grup ${bilinmeyen}` : ''} · ${p.gruplar[0].ad} …`);
  });
  const buyuk = k.grup.gruplar.filter(g => g.metinler.reduce((s, m) => s + m.en.length, 0) > k.hedef).map(g => g.ad);
  console.log(`hedefi tek başına aşıp metin sınırından bölünen grup: ${buyuk.length ? buyuk.join(', ') : 'yok'}`);
  console.log('bu araç şunu ölçmez: parçaların anlam bakımından iyi bölünüp bölünmediği · ajanın bağlamı kullanıp kullanmadığı · konuşmacı adı girişinin hangi repliğe ait olduğu');
}

// --- karşı test: bilerek boz, yakalıyor mu ---
function sina() {
  let basarisiz = 0;
  const dene = (ad, kosul) => { console.log(`${kosul ? 'TAMAM' : 'BAŞARISIZ'}  ${ad}`); if (!kosul) basarisiz++; };
  const g = (ns, key, h, deger) => ({ ns, key, kaynakHash: h, deger });
  const girisler = [
    g('', 'K1', 1, 'Hello'), g('', 'K2', 2, 'Pluto'), g('', 'K3', 3, 'Hello'), g('', 'K4', 4, ''),
    g('UserInterface', 'U1', 5, 'Start'), g('', 'X1', 6, 'Zed'), g('', 'K5', 7, 'Second'),
  ];
  const konum = new Map([['K1', { rel: 'B/Conv1', o: 20 }], ['K2', { rel: 'A/Conv0', o: 5 }], ['K3', { rel: 'A/Conv0', o: 9 }], ['K5', { rel: 'B/Conv1', o: 10 }]]);
  const r = metinGruplari(girisler, konum);
  const adlar = r.gruplar.map(x => x.ad);
  dene('gruplar: bilinen gruplar ada göre sıralı, ad alanlı ve yeri bilinmeyen en sonda',
    JSON.stringify(adlar) === JSON.stringify(['A/Conv0', 'B/Conv1', '(ad alanı: UserInterface)', YERI_BILINMEYEN]));
  dene('gruplar: grup içi sıra (K2 o=5, K3 o=9) ve tekilleştirmeden sonra B grubunda yalnız Second kalıyor',
    r.gruplar[0].metinler.map(m => m.en).join() === 'Pluto,Hello' && r.gruplar[1].metinler.map(m => m.en).join() === 'Second');
  // Yukarıdaki veride locres sırası ile dosya sırası zaten aynı: sıralamayı kaldıran ya da locres sırasına çeviren bozma
  // (bozma turu 3 ve 4) geçiyordu. Burada ikisi ayrışıyor: C2 locres'te sonra, dosyada önce (o=10 < o=30).
  const r2 = metinGruplari([g('', 'C1', 8, 'Late'), g('', 'C2', 9, 'Early')], new Map([['C1', { rel: 'C/Conv2', o: 30 }], ['C2', { rel: 'C/Conv2', o: 10 }]]));
  dene('gruplar: grup içi sıra locres sırası değil dosya sırası (C1 locres\'te önce ama o=30, C2 o=10; beklenen Early,Late)',
    r2.gruplar.length === 1 && r2.gruplar[0].metinler.map(m => m.en).join() === 'Early,Late' && r2.gruplar[0].metinler.map(m => m.id).join() === '1,2');
  dene('gruplar: aynı İngilizce metin TEK kez, ilk görüldüğü grupta (Hello yalnızca A/Conv0\'da)', r.gruplar.flatMap(x => x.metinler).filter(m => m.en === 'Hello').length === 1);
  dene('gruplar: kimlikler 1\'den başlayıp grup sırasıyla boşluksuz artıyor', r.gruplar.flatMap(x => x.metinler).map(m => m.id).join() === '1,2,3,4,5');
  const idDe = (key) => r.eslesme.find(e => e.key === key).id;
  dene('eşleşme: tekrarlanan metnin iki girişi (K1, K3) aynı kimliğe bağlanıyor, boş giriş (K4) 0, ötekiler kendi kimliğine',
    idDe('K1') === 2 && idDe('K3') === 2 && idDe('K4') === 0 && idDe('K2') === 1 && idDe('K5') === 3 && idDe('U1') === 4 && idDe('X1') === 5);
  dene('gruplar: boş metin sayılıyor ama çevrilmiyor; yeri bilinmeyen sayısı 2 (Start, Zed)', r.bos === 1 && r.yeriBilinmeyen === 2);
  const eslesmeMetni = (e) => (e.id ? r.gruplar.flatMap(x => x.metinler).find(m => m.id === e.id).en : '');
  dene('eşleşme: her girişin kimliği kendi İngilizce metnine çıkıyor (yamada yanlış satıra çeviri gitmez)', r.eslesme.every((e, i) => eslesmeMetni(e) === girisler[i].deger));

  // parçalama
  const mk = (ad, n, uzun = 10, ilkId = 1) => ({ ad, metinler: Array.from({ length: n }, (_, i) => ({ id: ilkId + i, en: 'x'.repeat(uzun) })) });
  const p1 = parcala([mk('a', 3, 10, 1), mk('b', 2, 10, 4), mk('c', 1, 10, 6)], 40);
  dene('parçalama: parça sınırı grup sınırı (a | b+c), hiçbir grup bölünmedi, hedef aşılmadı',
    p1.length === 2 && p1[0].gruplar.map(x => x.ad).join() === 'a' && p1[1].gruplar.map(x => x.ad).join() === 'b,c' && p1.every(p => p.karakter <= 40));
  const p2 = parcala([mk('g', 5, 10, 1), mk('h', 1, 10, 6)], 20);
  dene('parçalama: tek başına hedefi aşan grup metin sınırından bölünüyor ("(devam)"), hedef aşılmıyor, sonraki grup karışmıyor',
    p2.map(p => p.gruplar.map(x => x.ad).join()).join('|') === 'g|g (devam)|g (devam)|h' && p2.every(p => p.karakter <= 20));
  dene('parçalama: bölünen grupta her kimlik tam bir kez', kimlikSorunlari(p2, 6).length === 0);
  // Bozma turu 16: büyük grubun önündeki küçük grup, büyük grubun parçalarından ÖNCE kapanmalı (sıra bozulmasın, karışmasın).
  const p3 = parcala([mk('s', 1, 10, 1), mk('big', 5, 10, 2)], 20);
  dene('parçalama: büyük grubun önündeki küçük grup kendi parçasında ve önce geliyor (s | big | big (devam) | big (devam))',
    p3.map(p => p.gruplar.map(x => x.ad).join()).join('|') === 's|big|big (devam)|big (devam)' && kimlikSorunlari(p3, 6).length === 0);
  // Bozma turu 17: tek metin hedeften uzunsa boş parça çıkmamalı (her parçada en az bir metin; hedef bu durumda aşılır, kaçınılmaz).
  const p4 = parcala([mk('l', 2, 30, 1)], 20);
  dene('parçalama: tek metin hedeften uzunsa boş parça çıkmıyor (l | l (devam), her biri bir metin)',
    p4.length === 2 && p4.every(p => p.gruplar[0].metinler.length === 1) && kimlikSorunlari(p4, 2).length === 0);
  dene('kapı: eksik kimlik yakalanıyor', kimlikSorunlari([{ gruplar: [mk('a', 2, 1, 1)] }], 3).some(s => /hiçbir parçada yok/.test(s)));
  dene('kapı: yinelenen kimlik yakalanıyor', kimlikSorunlari([{ gruplar: [mk('a', 2, 1, 1)] }, { gruplar: [mk('b', 1, 1, 2)] }], 2).some(s => /birden çok/.test(s)));
  dene('kapı: aralık dışı kimlik yakalanıyor', kimlikSorunlari([{ gruplar: [mk('a', 2, 1, 1)] }], 1).some(s => /dışında/.test(s)));
  const zor = { ad: 'Z "tırnak"', metinler: [{ id: 1, en: 'Satır\nsonu <b>kalın</b> {0} "alıntı" ğüşiöç \\' }] };
  const geriOkunan = JSON.parse(parcaJson({ gruplar: [zor], karakter: 5 }, 1, 1));
  dene('dosya: parça JSON\'u geri okununca metin ve grup adı birebir aynı (satır sonu, etiket, yer tutucu, tırnak, Türkçe harf)',
    geriOkunan.gruplar[0].metinler[0].en === zor.metinler[0].en && geriOkunan.gruplar[0].ad === zor.ad && geriOkunan.metinSayisi === 1);

  // gerçek oyun
  const paketler = yuklePaket();
  const k = kur(paketler, 12);
  paketler.forEach(p => p.kapat());
  const toplam = k.grup.gruplar.reduce((t, x) => t + x.metinler.length, 0);
  dene('gerçek: kimlikler parçalarda 1..N tam bir kez', kimlikSorunlari(k.parcalar, toplam).length === 0);
  const benzersiz = new Set(k.en.girisler.filter(x => x.deger !== '').map(x => x.deger)).size;
  dene('gerçek: çevrilecek metin sayısı, locres\'in boş olmayan benzersiz metin sayısıyla aynı', toplam === benzersiz);
  dene('gerçek: her giriş kendi İngilizce metnine çıkan kimliğe bağlı', (() => {
    const metinById = new Map(k.grup.gruplar.flatMap(x => x.metinler).map(m => [m.id, m.en]));
    return k.grup.eslesme.every((e, i) => (e.id === 0 ? k.en.girisler[i].deger === '' : metinById.get(e.id) === k.en.girisler[i].deger));
  })());
  dene('gerçek: parça sayısı 12 ile 15 arasında ve hiçbiri boş', k.parcalar.length >= 12 && k.parcalar.length <= 15 && k.parcalar.every(p => p.gruplar.length > 0));
  dene('gerçek: hiçbir parça hedefi aşmıyor (tek grup aşarsa bölündüğü için)', k.parcalar.every(p => p.karakter <= k.hedef));
  dene('gerçek: konuşma varlıkları bulunuyor (yeri bilinmeyen metin toplamın %15\'inden az; build değişirse uyarır)', k.grup.yeriBilinmeyen < 0.15 * toplam);
  dene('gerçek: ad tablosu okunamayan varlık yok', k.konum.adHatalari.length === 0);
  console.log(basarisiz ? `\n${basarisiz} sınama başarısız` : '\nhepsi tamam');
  process.exit(basarisiz ? 1 : 0);
}

try {
  if (arg.includes('--sina')) sina(); else uret();
} catch (e) {
  console.error(`ÖLÇÜM BAŞARISIZ: ${e.message}`);
  process.exit(1);
}
