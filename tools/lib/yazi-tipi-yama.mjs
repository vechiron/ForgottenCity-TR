// Başlık yazı tipinde (goudytrajan-bold-pro) küçük `i` (U+0069) noktasız büyük I glifine bağlı;
// bu yüzden "Yeni" başlıkta YENI çiziliyor. Yama iki parça:
//  1) kısa boy noktalı İ glifi: yazı tipinin kullanılmayan `Iogonek.sc` glifinin charstring'i yerine, `i`nin kısa boy
//     I gövdesi + büyük İ'nin noktası (gövdenin tepe farkı kadar aşağı, yatayda gövdeye ortalı) yazılır;
//  2) cmap'te U+0069 bu yeni glife bağlanır (küçük harfler kısa büyük harf çizildiği için İ komşularıyla aynı boyda kalır).
import { cffAc, cffGlifDegistir, charstringYaz, glifYolu, konturKaydir, konturlar, sinirKutusu } from './cff.mjs';

// Saf işlev: bayt alır, bayt verir; diske yazmaz. Kendi çıktısını yeniden okuyup doğrular, düzen
// tanınmazsa hata fırlatır (sessiz geçmez). Yalnızca cmap (3,1) biçim 4 altyapısını yeniden kurar;
// yeni cmap dosyanın SONUNA eklenir, dizin kaydı yeni konuma çevrilir (eskisi yerinde kalır, ölü bayt).

const u16 = (b, o) => b.readUInt16BE(o);
const i16 = (b, o) => b.readInt16BE(o);

function tabloBul(b, ad) {
  const n = u16(b, 4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    if (b.toString('latin1', o, o + 4) === ad) return { kayit: o, off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) };
  }
  throw new Error(`tablo yok: ${ad}`);
}

// cmap (3,1) biçim 4 alt tablosunun segmentlerini ve glif dizisini okur.
function altTabloOku(b, cm) {
  const nt = u16(b, cm.off + 2);
  let so = -1;
  for (let i = 0; i < nt; i++) {
    const p = cm.off + 4 + i * 8;
    if (u16(b, p) === 3 && u16(b, p + 2) === 1) so = b.readUInt32BE(p + 4);
  }
  if (so < 0) throw new Error('cmap (3,1) alt tablosu yok');
  const t = cm.off + so;
  if (u16(b, t) !== 4) throw new Error('cmap (3,1) biçim 4 değil');
  const uzun = u16(b, t + 2), x2 = u16(b, t + 6), sc = x2 / 2;
  if (uzun < 16 + x2 * 4) throw new Error('biçim 4 uzunluğu tutarsız');
  const e = t + 14, s = e + x2 + 2, d = s + x2, r = d + x2, g = r + x2;
  const seg = [];
  for (let i = 0; i < sc; i++) {
    const ro = u16(b, r + 2 * i);
    seg.push({
      son: u16(b, e + 2 * i), bas: u16(b, s + 2 * i), delta: i16(b, d + 2 * i),
      // ro > 0: glif dizisine indeks (bu segmentin kendi ro girdisine göre) — mutlak indekse çevrilir
      gi: ro ? (ro / 2 - (sc - i)) : -1,
    });
  }
  const gDizi = [];
  for (let o = g; o < t + uzun; o += 2) gDizi.push(u16(b, o));
  return { t, so, uzun, seg, gDizi };
}

function altTabloYaz(seg, gDizi) {
  const sc = seg.length, x2 = sc * 2;
  let ss = 1; while (ss * 2 <= sc) ss *= 2;
  const uzun = 16 + x2 * 4 + gDizi.length * 2;
  const o = Buffer.alloc(uzun);
  o.writeUInt16BE(4, 0); o.writeUInt16BE(uzun, 2); o.writeUInt16BE(0, 4); o.writeUInt16BE(x2, 6);
  o.writeUInt16BE(ss * 2, 8); o.writeUInt16BE(Math.log2(ss), 10); o.writeUInt16BE(x2 - ss * 2, 12);
  const e = 14, s = e + x2 + 2, d = s + x2, r = d + x2;
  seg.forEach((g, i) => {
    o.writeUInt16BE(g.son, e + 2 * i); o.writeUInt16BE(g.bas, s + 2 * i); o.writeInt16BE(g.delta, d + 2 * i);
    o.writeUInt16BE(g.gi < 0 ? 0 : (g.gi + (sc - i)) * 2, r + 2 * i);
  });
  gDizi.forEach((v, i) => o.writeUInt16BE(v, r + x2 + 2 * i));
  return o;
}

// bir kod noktasının glifi (segmentlerden)
export function glifBul(seg, gDizi, kod) {
  for (const g of seg) {
    if (kod < g.bas || kod > g.son) continue;
    if (g.gi < 0) return (kod + g.delta) & 0xFFFF;
    const v = gDizi[g.gi + (kod - g.bas)];
    return v === 0 ? 0 : (v + g.delta) & 0xFFFF;
  }
  return 0;
}

function toplam(b) {
  let t = 0;
  const n = b.length & ~3;
  for (let i = 0; i < n; i += 4) t = (t + b.readUInt32BE(i)) >>> 0;
  if (b.length & 3) { const k = Buffer.alloc(4); b.copy(k, 0, n); t = (t + k.readUInt32BE(0)) >>> 0; }
  return t;
}

export function cmapOku(bayt) {
  const b = Buffer.from(bayt);
  const a = altTabloOku(b, tabloBul(b, 'cmap'));
  return { glif: kod => glifBul(a.seg, a.gDizi, kod), segSayisi: a.seg.length };
}

const HEDEF_GLIF_ADI = 'Iogonek.sc'; // kullanılmayan glif: Türkçede Į yok; yeni kısa boy İ onun yerine yazılır

function dizinToplamiDuzelt(cikti) {
  const hd = tabloBul(cikti, 'head');
  cikti.writeUInt32BE(0, hd.off + 8);
  cikti.writeUInt32BE((0xB1B0AFBA - toplam(cikti)) >>> 0, hd.off + 8);
}

// Kısa boy noktalı İ glifini kurar. CFF tablosu dosyanın SON tablosu olmalı (yerinde yeniden yazılır).
// Verir: { bayt, gid, kisaI } — gid = yeni glifin numarası, kisaI = gövdesinin alındığı glif (`i` → glif 74).
export function kisaBoyIKur(bayt, kisaI, uzunIN) {
  const b = Buffer.from(bayt);
  const t = tabloBul(b, 'CFF ');
  const cff = b.subarray(t.off, t.off + t.len);
  const cf = cffAc(cff);
  let hedef = -1;
  for (let g = 1; g < cf.gidSayisi; g++) if (cf.ad(g) === HEDEF_GLIF_ADI) hedef = g;
  if (hedef < 0) throw new Error(`${HEDEF_GLIF_ADI} glifi yok`);
  if (kisaI === hedef) throw new Error('zaten yamalı');
  const n = u16(b, 4);
  for (let k = 0; k < n; k++) { const o = 12 + k * 16; if (b.readUInt32BE(o + 8) > t.off) throw new Error('CFF son tablo değil: beklenmeyen düzen'); }
  const hm = tabloBul(b, 'hmtx'), nh = u16(b, tabloBul(b, 'hhea').off + 34);
  const adv = g => b.readUInt16BE(hm.off + 4 * Math.min(g, nh - 1));
  if (nh !== cf.gidSayisi) throw new Error('hmtx her glif için tam kayıt değil: beklenmeyen düzen');
  if (adv(hedef) !== adv(kisaI)) throw new Error('hedef glifin genişliği kısa boy I ile aynı değil');
  const gov = glifYolu(cf, kisaI), uzun = glifYolu(cf, uzunIN);
  const uk = konturlar(uzun.yol);
  if (uk.length !== 2) throw new Error(`İ glifi ${uk.length} konturlu, 2 bekleniyordu (gövde + nokta)`);
  const kk = uk.map(sinirKutusu);
  const noktaI = kk[0].y1 > kk[1].y1 ? 0 : 1, govI = 1 - noktaI;
  const govKutu = sinirKutusu(gov.yol);
  const dy = Math.round(govKutu.y1 - kk[govI].y1);                       // nokta, gövdenin tepe farkı kadar iner
  const dx = Math.round((govKutu.x0 + govKutu.x1) / 2 - (kk[noktaI].x0 + kk[noktaI].x1) / 2); // yatayda gövdeye ortalı
  const yeniKonturlar = [...konturlar(gov.yol), konturKaydir(uk[noktaI], dx, dy)];
  const cs = charstringYaz(yeniKonturlar, adv(hedef), cf.nom, cf.vars);
  const yeniCff = cffGlifDegistir(cff, hedef, cs);
  // dosyanın sonuna yerinde yaz: CFF zaten son tablo
  const pad = (4 - (yeniCff.length & 3)) & 3;
  const cikti = Buffer.concat([b.subarray(0, t.off), yeniCff, Buffer.alloc(pad)]);
  cikti.writeUInt32BE(toplam(yeniCff), t.kayit + 4);
  cikti.writeUInt32BE(yeniCff.length, t.kayit + 12);
  dizinToplamiDuzelt(cikti);
  // doğrulama: yeniden oku; başka hiçbir glif ve tablo değişmedi, yeni glif beklenen konturlarla birebir
  const c2 = cffAc(cikti.subarray(t.off, t.off + yeniCff.length));
  if (c2.gidSayisi !== cf.gidSayisi) throw new Error('doğrulama: glif sayısı değişti');
  for (let g = 0; g < cf.gidSayisi; g++) {
    if (g === hedef) continue;
    if (!c2.cs.oge[g].equals(cf.cs.oge[g])) throw new Error(`doğrulama: glif ${g} değişti`);
    if (c2.ad(g) !== cf.ad(g)) throw new Error(`doğrulama: glif ${g} adı değişti`);
  }
  const y2 = glifYolu(c2, hedef);
  if (y2.genislik !== adv(hedef)) throw new Error('doğrulama: yeni glif genişliği tutmuyor');
  const bek = yeniKonturlar.map(k => JSON.stringify(k.map(s => Object.values(s).map(v => typeof v === 'number' ? Math.round(v) : v))));
  const got = konturlar(y2.yol).map(k => JSON.stringify(k.map(s => Object.values(s).map(v => typeof v === 'number' ? Math.round(v) : v))));
  if (bek.length !== got.length || bek.some((x, k) => x !== got[k])) throw new Error('doğrulama: yeni glifin konturları beklenenle aynı değil');
  for (const ad of ['hmtx', 'cmap', 'GSUB', 'GPOS', 'kern', 'head', 'hhea', 'maxp', 'OS/2', 'name', 'post']) {
    const x = tabloBul(b, ad), y = tabloBul(cikti, ad);
    const xb = b.subarray(x.off, x.off + x.len), yb = cikti.subarray(y.off, y.off + y.len);
    if (ad === 'head') { if (!xb.subarray(0, 8).equals(yb.subarray(0, 8)) || !xb.subarray(12).equals(yb.subarray(12))) throw new Error('doğrulama: head değişti'); continue; }
    if (!xb.equals(yb)) throw new Error(`doğrulama: ${ad} tablosu değişti`);
  }
  return { bayt: cikti, gid: hedef };
}

export function iNoktaliYap(bayt) {
  const I = 0x49, i = 0x69, IN = 0x130;
  const b0 = Buffer.from(bayt);
  const a0 = altTabloOku(b0, tabloBul(b0, 'cmap'));
  const glifIN0 = glifBul(a0.seg, a0.gDizi, IN), glifI0 = glifBul(a0.seg, a0.gDizi, i);
  if (!glifIN0) throw new Error('İ (U+0130) glifi yok');
  if (glifI0 === glifIN0) throw new Error('zaten yamalı');
  const { bayt: b, gid: glifIN } = kisaBoyIKur(b0, glifI0, glifIN0);
  if (glifBul(a0.seg, a0.gDizi, i) === glifIN) throw new Error('zaten yamalı');
  const cm = tabloBul(b, 'cmap');
  const a = altTabloOku(b, cm);
  const k = a.seg.findIndex(g => g.bas <= i && i <= g.son);
  const g = a.seg[k];
  if (g.gi >= 0) throw new Error('i segmenti glif dizili: beklenmeyen düzen');
  const yeni = [
    { ...g, son: i - 1 },
    { bas: i, son: i, delta: ((glifIN - i + 0x18000) & 0xFFFF) - 0x8000, gi: -1 },
    { ...g, bas: i + 1 },
  ].filter(x => x.bas <= x.son);
  const seg = [...a.seg.slice(0, k), ...yeni, ...a.seg.slice(k + 1)];
  const alt = altTabloYaz(seg, a.gDizi);
  // yeni cmap: eski cmap'in alt tablo öncesi baytları (başlık, kayıtlar, öteki alt tablolar) aynen + yeni biçim 4
  // Not: eski biçim 4 alt tablosu cmap içinde SONDA olmalı; değilse hata.
  if (a.so + a.uzun !== cm.len && a.so + a.uzun + 3 < cm.len) throw new Error('biçim 4 cmap sonunda değil: beklenmeyen düzen');
  const onek = b.subarray(cm.off, cm.off + a.so);
  const cmYeni = Buffer.concat([onek, alt]);
  const bas = b.length + ((4 - (b.length & 3)) & 3);
  const cikti = Buffer.concat([b, Buffer.alloc(bas - b.length), cmYeni, Buffer.alloc((4 - (cmYeni.length & 3)) & 3)]);
  cikti.writeUInt32BE(toplam(cmYeni), cm.kayit + 4);
  cikti.writeUInt32BE(bas, cm.kayit + 8);
  cikti.writeUInt32BE(cmYeni.length, cm.kayit + 12);
  const hd = tabloBul(cikti, 'head');
  cikti.writeUInt32BE(0, hd.off + 8);
  cikti.writeUInt32BE((0xB1B0AFBA - toplam(cikti)) >>> 0, hd.off + 8);

  // doğrulama: yeniden oku; i → İ glifi, geri kalan HER kod noktası değişmedi
  const eski = cmapOku(b), yeniOku = cmapOku(cikti);
  if (yeniOku.glif(i) !== glifIN) throw new Error('doğrulama: i İ glifine bağlanmadı');
  for (let kod = 0; kod <= 0xFFFF; kod++) {
    if (kod === i) continue;
    if (eski.glif(kod) !== yeniOku.glif(kod)) throw new Error(`doğrulama: U+${kod.toString(16)} değişti`);
  }
  return cikti;
}
