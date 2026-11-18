// Minimal CFF (Type 2) okuyucu: INDEX, DICT, charset (glif adları), Type 2 charstring → mutlak yol komutları. SAF: yalnız bellekte.
// Amaç: başlık yazı tipinde küçük boy noktalı İ glifini kurmak (tools/lib/yazi-tipi-yama.mjs). Kapsam: tek yazı tipli (CID olmayan) CFF.
// Hata durumunda sessiz geçmez, fırlatır.

export function indexOku(b, o) {
  const n = b.readUInt16BE(o);
  if (n === 0) return { oge: [], son: o + 2 };
  const os = b[o + 2], ofs = [];
  for (let i = 0; i <= n; i++) { let v = 0; for (let k = 0; k < os; k++) v = v * 256 + b[o + 3 + i * os + k]; ofs.push(v); }
  const veri = o + 3 + (n + 1) * os - 1;
  const oge = []; for (let i = 0; i < n; i++) oge.push(b.subarray(veri + ofs[i], veri + ofs[i + 1]));
  return { oge, son: veri + ofs[n] };
}

export function indexYaz(oge) {
  const n = oge.length;
  if (n === 0) return Buffer.from([0, 0]);
  const toplam = oge.reduce((t, x) => t + x.length, 0) + 1;
  const os = toplam < 256 ? 1 : toplam < 65536 ? 2 : toplam < 1 << 24 ? 3 : 4;
  const baslik = Buffer.alloc(3 + (n + 1) * os);
  baslik.writeUInt16BE(n, 0); baslik[2] = os;
  let p = 1;
  for (let i = 0; i <= n; i++) { for (let k = 0; k < os; k++) baslik[3 + i * os + k] = (p >>> (8 * (os - 1 - k))) & 255; if (i < n) p += oge[i].length; }
  return Buffer.concat([baslik, ...oge]);
}

// DICT: { op: [operandlar] } ve her operandın ham bayt yeri (ofset, uzunluk) — yerinde yama için
export function dictOku(b) {
  const sonuc = new Map(); let st = [], i = 0;
  while (i < b.length) {
    const c = b[i];
    if (c <= 21) {
      let op = c; i++;
      if (c === 12) { op = 1200 + b[i]; i++; }
      sonuc.set(op, st); st = [];
    } else if (c === 28) { st.push({ v: b.readInt16BE(i + 1), ofs: i, len: 3 }); i += 3; }
    else if (c === 29) { st.push({ v: b.readInt32BE(i + 1), ofs: i, len: 5 }); i += 5; }
    else if (c === 30) { let j = i + 1; while ((b[j] & 15) !== 15 && (b[j] >> 4) !== 15) j++; st.push({ v: NaN, ofs: i, len: j - i + 1 }); i = j + 1; }
    else if (c >= 32 && c <= 246) { st.push({ v: c - 139, ofs: i, len: 1 }); i++; }
    else if (c >= 247 && c <= 250) { st.push({ v: (c - 247) * 256 + b[i + 1] + 108, ofs: i, len: 2 }); i += 2; }
    else if (c >= 251 && c <= 254) { st.push({ v: -(c - 251) * 256 - b[i + 1] - 108, ofs: i, len: 2 }); i += 2; }
    else throw new Error(`DICT: tanınmayan bayt ${c}`);
  }
  return sonuc;
}

const sapma = (n) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

export function cffAc(cff) {
  const b = Buffer.from(cff);
  if (b[0] !== 1) throw new Error('CFF sürümü 1 değil');
  const adlar = indexOku(b, b[2]);
  const ust = indexOku(b, adlar.son);
  const dizgiler = indexOku(b, ust.son);
  const gsubr = indexOku(b, dizgiler.son);
  const top = dictOku(ust.oge[0]);
  if (top.has(1230)) throw new Error('CID yazı tipi: desteklenmiyor');
  const csOfs = top.get(17)?.[0].v, charsetOfs = top.get(15)?.[0].v, priv = top.get(18);
  if (csOfs == null || charsetOfs == null || !priv) throw new Error('Top DICT eksik (CharStrings/charset/Private)');
  const cs = indexOku(b, csOfs);
  const pBoy = priv[0].v, pOfs = priv[1].v;
  const pd = dictOku(b.subarray(pOfs, pOfs + pBoy));
  const lsubr = pd.has(19) ? indexOku(b, pOfs + pd.get(19)[0].v) : { oge: [] };
  const nom = pd.get(21)?.[0].v ?? 0, vars = pd.get(20)?.[0].v ?? 0;
  // charset → SID'ler (gid 0 = .notdef)
  const n = cs.oge.length, sid = [0];
  let o = charsetOfs; const bicim = b[o++];
  if (bicim === 0) for (let g = 1; g < n; g++, o += 2) sid.push(b.readUInt16BE(o));
  else if (bicim === 1 || bicim === 2) {
    while (sid.length < n) {
      const ilk = b.readUInt16BE(o); o += 2;
      const sol = bicim === 1 ? b[o++] : (o += 2, b.readUInt16BE(o - 2));
      for (let k = 0; k <= sol && sid.length < n; k++) sid.push(ilk + k);
    }
  } else throw new Error(`charset biçimi ${bicim} tanınmıyor`);
  const ad = (g) => (sid[g] >= 391 ? dizgiler.oge[sid[g] - 391]?.toString('latin1') : `std${sid[g]}`);
  return { b, top, cs, gsubr, lsubr, nom, vars, ad, gidSayisi: n, csOfs, ust, topBaytlari: ust.oge[0] };
}

// Type 2 charstring → { yol: [{t:'M'|'L'|'C'|'Z', ...mutlak}], genislik }
export function glifYolu(cf, gid) {
  const yol = []; let x = 0, y = 0, aciksa = false, genislik = null, nHint = 0, st = [], ilk = true;
  const kapat = () => { if (aciksa) { yol.push({ t: 'Z' }); aciksa = false; } };
  const gen = (azKalan) => { if (ilk) { ilk = false; if (st.length > azKalan) genislik = cf.nom + st.shift(); } };
  const tasi = (dx, dy) => { kapat(); x += dx; y += dy; yol.push({ t: 'M', x, y }); aciksa = true; };
  const cizgi = (dx, dy) => { x += dx; y += dy; yol.push({ t: 'L', x, y }); };
  const egri = (a, b2, c, d, e, f) => { const x1 = x + a, y1 = y + b2, x2 = x1 + c, y2 = y1 + d; x = x2 + e; y = y2 + f; yol.push({ t: 'C', x1, y1, x2, y2, x, y }); };
  let bitti = false;
  const kos = (kod, derinlik) => {
    if (derinlik > 10) throw new Error('altyordam derinliği');
    let i = 0;
    while (i < kod.length && !bitti) {
      const c = kod[i++];
      if (c === 28) { st.push(kod.readInt16BE(i)); i += 2; }
      else if (c >= 32 && c <= 246) st.push(c - 139);
      else if (c >= 247 && c <= 250) st.push((c - 247) * 256 + kod[i++] + 108);
      else if (c >= 251 && c <= 254) st.push(-(c - 251) * 256 - kod[i++] - 108);
      else if (c === 255) { st.push(kod.readInt32BE(i) / 65536); i += 4; }
      else switch (c) {
        case 1: case 3: case 18: case 23: gen(st.length & ~1); nHint += st.length >> 1; st = []; break;
        case 19: case 20: gen(st.length & ~1); nHint += st.length >> 1; st = []; i += Math.ceil(nHint / 8); break;
        case 21: gen(2); tasi(st[0], st[1]); st = []; break;
        case 22: gen(1); tasi(st[0], 0); st = []; break;
        case 4: gen(1); tasi(0, st[0]); st = []; break;
        case 5: for (let k = 0; k + 1 < st.length; k += 2) cizgi(st[k], st[k + 1]); st = []; break;
        case 6: case 7: { let h = c === 6; for (const v of st) { if (h) cizgi(v, 0); else cizgi(0, v); h = !h; } st = []; break; }
        case 8: for (let k = 0; k + 5 < st.length; k += 6) egri(...st.slice(k, k + 6)); st = []; break;
        case 24: { let k = 0; for (; k + 6 <= st.length - 2; k += 6) egri(...st.slice(k, k + 6)); cizgi(st[k], st[k + 1]); st = []; break; }
        case 25: { let k = 0; for (; k + 2 <= st.length - 6; k += 2) cizgi(st[k], st[k + 1]); egri(...st.slice(k, k + 6)); st = []; break; }
        case 26: { let k = 0, dx1 = 0; if (st.length & 1) dx1 = st[k++]; for (; k + 3 < st.length; k += 4) { egri(dx1, st[k], st[k + 1], st[k + 2], 0, st[k + 3]); dx1 = 0; } st = []; break; }
        case 27: { let k = 0, dy1 = 0; if (st.length & 1) dy1 = st[k++]; for (; k + 3 < st.length; k += 4) { egri(st[k], dy1, st[k + 1], st[k + 2], st[k + 3], 0); dy1 = 0; } st = []; break; }
        case 30: case 31: {
          let h = c === 31, k = 0;
          while (k + 3 < st.length) {
            const son = st.length - k === 5 ? st[k + 4] : 0;
            if (h) egri(st[k], 0, st[k + 1], st[k + 2], son, st[k + 3]); else egri(0, st[k], st[k + 1], st[k + 2], st[k + 3], son);
            h = !h; k += 4;
          }
          st = []; break;
        }
        case 10: { const n = st.pop(); const s = cf.lsubr.oge[n + sapma(cf.lsubr.oge.length)]; if (!s) throw new Error(`yerel altyordam ${n} yok`); kos(s, derinlik + 1); break; }
        case 29: { const n = st.pop(); const s = cf.gsubr.oge[n + sapma(cf.gsubr.oge.length)]; if (!s) throw new Error(`genel altyordam ${n} yok`); kos(s, derinlik + 1); break; }
        case 11: return;
        case 14: gen(st.length === 4 ? 4 : 0); if (st.length >= 4) throw new Error('endchar seac biçimi: desteklenmiyor'); bitti = true; break;
        case 12: throw new Error(`escape işleci (12 ${kod[i]}) desteklenmiyor`);
        default: throw new Error(`charstring işleci ${c} tanınmıyor (glif ${gid})`);
      }
    }
  };
  kos(cf.cs.oge[gid], 0);
  kapat();
  return { yol, genislik: genislik ?? cf.vars };
}

export function sinirKutusu(yol) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ekle = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const k of yol) { if (k.t === 'M' || k.t === 'L') ekle(k.x, k.y); else if (k.t === 'C') { ekle(k.x1, k.y1); ekle(k.x2, k.y2); ekle(k.x, k.y); } }
  return { x0, y0, x1, y1 };
}

// ---- YAZMA TARAFI ----

// yol → konturlar (her biri M ile başlayan komut dizisi; Z atılır)
export function konturlar(yol) {
  const k = []; let cur = null;
  for (const s of yol) { if (s.t === 'M') { cur = []; k.push(cur); } if (s.t !== 'Z') cur.push(s); }
  return k;
}

// konturu (dx, dy) kaydırır; koordinatlar tamsayıya yuvarlanır
export function konturKaydir(kontur, dx, dy) {
  return kontur.map(s => {
    if (s.t === 'C') return { t: 'C', x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy, x: s.x + dx, y: s.y + dy };
    return { t: s.t, x: s.x + dx, y: s.y + dy };
  });
}

function sayiYaz(n) {
  if (!Number.isInteger(n)) throw new Error(`charstring: tamsayı olmayan operand ${n}`);
  if (n >= -107 && n <= 107) return [n + 139];
  if (n >= 108 && n <= 1131) { const v = n - 108; return [247 + (v >> 8), v & 255]; }
  if (n >= -1131 && n <= -108) { const v = -n - 108; return [251 + (v >> 8), v & 255]; }
  if (n >= -32768 && n <= 32767) return [28, (n >> 8) & 255, n & 255];
  throw new Error(`charstring: operand aralık dışı ${n}`);
}

// Konturlardan hint'siz Type 2 charstring: rmoveto + rlineto/rrcurveto (art arda aynı tür tek işleçte), endchar.
// Genişlik defaultWidthX'e (vars) eşitse yazılmaz, değilse ilk işleçten önce (genislik − nominalWidthX).
export function charstringYaz(konturlari, genislik, nom, vars) {
  const bayt = []; let px = 0, py = 0, ilk = true;
  const yaz = (args, op) => { for (const a of args) bayt.push(...sayiYaz(a)); bayt.push(op); };
  const R = Math.round;
  for (const kont of konturlari) {
    if (!kont.length || kont[0].t !== 'M') throw new Error('charstring: kontur M ile başlamıyor');
    const m = kont[0], mx = R(m.x), my = R(m.y);
    const a = [mx - px, my - py];
    if (ilk && genislik !== vars) a.unshift(genislik - nom);
    ilk = false;
    yaz(a, 21); px = mx; py = my;
    for (let i = 1; i < kont.length;) {
      const t = kont[i].t; let j = i; const args = [];
      while (j < kont.length && kont[j].t === t) {
        const s = kont[j];
        if (t === 'L') { const x = R(s.x), y = R(s.y); args.push(x - px, y - py); px = x; py = y; }
        else if (t === 'C') {
          const x1 = R(s.x1), y1 = R(s.y1), x2 = R(s.x2), y2 = R(s.y2), x = R(s.x), y = R(s.y);
          args.push(x1 - px, y1 - py, x2 - x1, y2 - y1, x - x2, y - y2); px = x; py = y;
        } else throw new Error(`charstring: tanınmayan komut ${t}`);
        j++;
        if (args.length >= (t === 'L' ? 48 : 42)) break; // yığın sınırı 48
      }
      yaz(args, t === 'L' ? 5 : 8); i = j;
    }
  }
  bayt.push(14);
  return Buffer.from(bayt);
}

function dictOperandDegistir(dictBayt, op, indeks, yeniDeger) {
  // operandı 5 baytlık tamsayı (29) olarak yeniden yazar; yeni DICT baytlarını verir
  const d = dictOku(dictBayt); const o = d.get(op)?.[indeks];
  if (!o) throw new Error(`DICT: ${op} operatörü ${indeks}. operand yok`);
  const yeni = Buffer.alloc(5); yeni[0] = 29; yeni.writeInt32BE(yeniDeger, 1);
  return Buffer.concat([dictBayt.subarray(0, o.ofs), yeni, dictBayt.subarray(o.ofs + o.len)]);
}

// Bir glifin charstring'ini değiştirir: CharStrings INDEX'i yeniden kurulur, Private bloğu (hemen arkasında olmalı) kayar,
// Top DICT'teki charset/CharStrings/Private konumları yeniden yazılır. Başka mutlak konum varsa (Encoding özel) hata.
export function cffGlifDegistir(cff, gid, yeniCs) {
  const cf = cffAc(cff); const b = cf.b;
  if (gid < 1 || gid >= cf.gidSayisi) throw new Error(`gid ${gid} aralık dışı`);
  const enc = cf.top.get(16)?.[0].v; if (enc > 1) throw new Error('özel Encoding konumu: desteklenmiyor');
  const csSon = indexOku(b, cf.csOfs).son, pOfs = cf.top.get(18)[1].v, csOfs = cf.csOfs, charsetOfs = cf.top.get(15)[0].v;
  if (pOfs !== csSon) throw new Error('Private bloğu CharStrings hemen arkasında değil: beklenmeyen düzen');
  if (!(charsetOfs < csOfs)) throw new Error('charset CharStrings öncesinde değil: beklenmeyen düzen');
  const oge = cf.cs.oge.map((x, i) => (i === gid ? yeniCs : x));
  const yeniCsIdx = indexYaz(oge);
  // Top DICT: konumlar 5 baytlık; boyut konumlardan bağımsız, iki geçişte kur
  let top = cf.topBaytlari;
  const kur = (topDelta) => {
    let t = dictOperandDegistir(top, 15, 0, charsetOfs + topDelta);
    t = dictOperandDegistir(t, 17, 0, csOfs + topDelta);
    t = dictOperandDegistir(t, 18, 1, pOfs + topDelta + (yeniCsIdx.length - (csSon - csOfs)));
    return t;
  };
  const eskiIdx = indexYaz([top]).length;
  const topIdxYaz = (t) => indexYaz([t]);
  const delta = topIdxYaz(kur(0)).length - eskiIdx;
  const yeniTop = kur(delta); const topIdx = topIdxYaz(yeniTop);
  if (topIdx.length - eskiIdx !== delta) throw new Error('Top DICT boyutu konumlara bağlı çıktı');
  // eski Top INDEX'in özgün baytları: ust.son − topIdxBaslangic
  const topBas = indexOku(b, b[2]).son;                // adlar INDEX sonu = Top INDEX başı
  const sonuc = Buffer.concat([b.subarray(0, topBas), topIdx, b.subarray(cf.ust.son, csOfs), yeniCsIdx, b.subarray(csSon)]);
  return sonuc;
}
