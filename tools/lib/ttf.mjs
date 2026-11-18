// TTF/OTF cmap okuyucu: bir yazı tipinin hangi karakterlere glif verdiğini ölçer. YALNIZCA OKUR.
// Göremedikleri: GSUB/GPOS (harf birleştirme, aksan yerleştirme) ve glifin gerçekten çizilebilir
// (boş olmayan) olduğu; yalnızca "cmap bu karakteri bir glife bağlıyor mu"yu söyler.

export function fontAc(b) {
  const etiket = b.toString('latin1', 0, 4);
  let ofs = 0;
  if (etiket === 'ttcf') ofs = b.readUInt32BE(12);
  else if (!['\0\x01\0\0', 'OTTO', 'true'].includes(etiket)) throw new Error(`tanınmayan yazı tipi başlığı: ${Buffer.from(etiket, 'latin1').toString('hex')}`);
  const tabloSayisi = b.readUInt16BE(ofs + 4);
  let cmapOfs = -1;
  for (let i = 0; i < tabloSayisi; i++) {
    const e = ofs + 12 + i * 16;
    if (b.toString('latin1', e, e + 4) === 'cmap') { cmapOfs = b.readUInt32BE(e + 8); break; }
  }
  if (cmapOfs < 0) throw new Error('cmap tablosu yok');

  const aralik = [];
  const altSayisi = b.readUInt16BE(cmapOfs + 2);
  for (let i = 0; i < altSayisi; i++) {
    const platform = b.readUInt16BE(cmapOfs + 4 + i * 8);
    const kodlama = b.readUInt16BE(cmapOfs + 6 + i * 8);
    const o = cmapOfs + b.readUInt32BE(cmapOfs + 8 + i * 8);
    if (!(platform === 0 || (platform === 3 && (kodlama === 1 || kodlama === 10)))) continue; // yalnızca Unicode alt tabloları
    const bicim = b.readUInt16BE(o);
    if (bicim === 4) {
      const seg = b.readUInt16BE(o + 6) / 2;
      const bitis = o + 14, baslangic = bitis + seg * 2 + 2, delta = baslangic + seg * 2, rofs = delta + seg * 2;
      for (let s = 0; s < seg; s++) {
        const ilk = b.readUInt16BE(baslangic + s * 2);
        if (ilk === 0xFFFF) continue;
        aralik.push({ ilk, son: b.readUInt16BE(bitis + s * 2), d: b.readInt16BE(delta + s * 2), r: b.readUInt16BE(rofs + s * 2), rk: rofs + s * 2, bicim: 4 });
      }
    } else if (bicim === 12) {
      const grup = b.readUInt32BE(o + 12);
      for (let g = 0; g < grup; g++) {
        const g0 = o + 16 + g * 12;
        aralik.push({ ilk: b.readUInt32BE(g0), son: b.readUInt32BE(g0 + 4), d: b.readUInt32BE(g0 + 8), r: 0, rk: 0, bicim: 12 });
      }
    }
  }
  if (!aralik.length) throw new Error('Unicode cmap alt tablosu bulunamadı');

  const glifVar = (kod) => {
    for (const a of aralik) {
      if (kod < a.ilk || kod > a.son) continue;
      if (a.bicim === 12) return true;
      if (a.r === 0) return ((kod + a.d) & 0xFFFF) !== 0;
      const gofs = a.rk + a.r + (kod - a.ilk) * 2;
      return gofs + 2 <= b.length && b.readUInt16BE(gofs) !== 0;
    }
    return false;
  };
  return { bicim: etiket === 'OTTO' ? 'OTF' : etiket === 'ttcf' ? 'TTC' : 'TTF', glifVar, eksik: (dizgi) => [...dizgi].filter(c => !glifVar(c.codePointAt(0))) };
}

/** Türkçe metin için gereken karakter grupları. */
export const TURKCE_GRUPLARI = {
  'Türkçe harfler': 'ÇçĞğİıÖöŞşÜü',
  'Çatılı (â î û)': 'ÂâÎîÛû',
  'Tipografik': '’‘“”…—–«»',
};
