// The Forgotten City Türkçe Yama - kurulum penceresi.
// Asıl işi yapmaz: yanındaki node.exe ile tools\yukleyici.mjs'yi çalıştırır, çıktısını (OYUN / DURUM / ADIM / HATA / BITTI) gösterir.
// Derleme: Windows'un kendi csc.exe'si (yukleyici\derle.ps1); ek kurulum gerekmez (.NET Framework 4).
// Gizli bayrak: --otomatik-kur (pencere açılır, "Yamayı kur"a kendisi basar, bitince çıkış koduyla kapanır; sınama için).
//            --otomatik-kaldir (aynısı kaldırma için).
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

class Pencere : Form
{
    readonly Label oyunEtiketi = new Label();
    readonly Label durumEtiketi = new Label();
    readonly TextBox gunluk = new TextBox();
    readonly Button kurDugmesi = new Button();
    readonly Button kaldirDugmesi = new Button();
    readonly Button klasorDugmesi = new Button();
    readonly Button kapatDugmesi = new Button();
    readonly string klasor = AppDomain.CurrentDomain.BaseDirectory;
    readonly string otomatik;
    string oyunKlasoru = null;
    bool calisiyor = false;
    int sonCikis = -1;

    public Pencere(string otomatikBayrak)
    {
        otomatik = otomatikBayrak;
        Text = "The Forgotten City Türkçe Yama";
        Size = new Size(640, 470);
        MinimumSize = new Size(560, 420);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9.5f);

        var baslik = new Label { Text = "The Forgotten City - Türkçe Yama", Font = new Font("Segoe UI", 14f, FontStyle.Bold), AutoSize = true, Location = new Point(16, 12) };
        oyunEtiketi.Location = new Point(16, 50); oyunEtiketi.Size = new Size(590, 22); oyunEtiketi.Text = "Oyun aranıyor…";
        durumEtiketi.Location = new Point(16, 74); durumEtiketi.Size = new Size(590, 22); durumEtiketi.ForeColor = Color.DimGray;

        kurDugmesi.Text = "Yamayı kur"; kurDugmesi.Location = new Point(16, 106); kurDugmesi.Size = new Size(150, 36);
        kaldirDugmesi.Text = "Yamayı kaldır"; kaldirDugmesi.Location = new Point(174, 106); kaldirDugmesi.Size = new Size(150, 36);
        klasorDugmesi.Text = "Oyun klasörünü seç…"; klasorDugmesi.Location = new Point(332, 106); klasorDugmesi.Size = new Size(170, 36);
        kapatDugmesi.Text = "Kapat"; kapatDugmesi.Location = new Point(510, 106); kapatDugmesi.Size = new Size(96, 36);
        kurDugmesi.Enabled = false; kaldirDugmesi.Enabled = false;

        gunluk.Multiline = true; gunluk.ReadOnly = true; gunluk.ScrollBars = ScrollBars.Vertical;
        gunluk.Location = new Point(16, 154); gunluk.Size = new Size(590, 258);
        gunluk.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        gunluk.BackColor = Color.White; gunluk.Font = new Font("Consolas", 9f);

        Controls.AddRange(new Control[] { baslik, oyunEtiketi, durumEtiketi, kurDugmesi, kaldirDugmesi, klasorDugmesi, kapatDugmesi, gunluk });

        kapatDugmesi.Click += delegate { Close(); };
        klasorDugmesi.Click += KlasorSec;
        kurDugmesi.Click += delegate { Calistir("kur"); };
        kaldirDugmesi.Click += delegate { Calistir("kaldir"); };
        Shown += delegate { Calistir("bul"); };
    }

    void Yaz(string metin)
    {
        if (InvokeRequired) { BeginInvoke(new Action<string>(Yaz), metin); return; }
        gunluk.AppendText(metin + Environment.NewLine);
    }

    void DugmeleriAyarla()
    {
        bool var = oyunKlasoru != null && !calisiyor;
        kurDugmesi.Enabled = var; kaldirDugmesi.Enabled = var;
        klasorDugmesi.Enabled = !calisiyor;
    }

    void KlasorSec(object o, EventArgs e)
    {
        using (var d = new FolderBrowserDialog())
        {
            d.Description = "The Forgotten City'nin kurulu olduğu klasörü seçin (içinde ModernStoryteller01 klasörü olan klasör).";
            if (d.ShowDialog() != DialogResult.OK) return;
            oyunKlasoru = d.SelectedPath;
            Calistir("bul");
        }
    }

    void Calistir(string komut)
    {
        if (calisiyor) return;
        calisiyor = true; DugmeleriAyarla();
        string nodeYolu = File.Exists(Path.Combine(klasor, "node.exe")) ? Path.Combine(klasor, "node.exe") : "node";
        string betik = Path.Combine(klasor, "tools", "yukleyici.mjs");
        string arg = "\"" + betik + "\" " + komut + (oyunKlasoru != null ? " --oyun \"" + oyunKlasoru.TrimEnd('\\') + "\"" : "");
        ThreadPool.QueueUserWorkItem(delegate
        {
            string hata = null; bool bitti = false; int cikis = -1;
            try
            {
                var psi = new ProcessStartInfo(nodeYolu, arg)
                {
                    WorkingDirectory = klasor, UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
                };
                using (var p = Process.Start(psi))
                {
                    p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs ev) { if (!string.IsNullOrEmpty(ev.Data)) Yaz(ev.Data); };
                    p.BeginErrorReadLine();
                    string satir;
                    while ((satir = p.StandardOutput.ReadLine()) != null)
                    {
                        string onek = satir.Length >= 4 ? satir.Substring(0, satir.IndexOf(' ') < 0 ? satir.Length : satir.IndexOf(' ')) : satir;
                        string govde = satir.IndexOf(' ') < 0 ? "" : satir.Substring(satir.IndexOf(' ') + 1);
                        if (onek == "OYUN") { string g = govde; BeginInvoke(new Action(delegate { oyunEtiketi.Text = "Oyun: " + g; })); oyunKlasoru = govde; }
                        else if (onek == "DURUM") { string g = govde; BeginInvoke(new Action(delegate { durumEtiketi.Text = DurumMetni(g); })); }
                        else if (onek == "HATA") { hata = govde; Yaz("HATA: " + govde); }
                        else if (onek == "BITTI") { bitti = true; Yaz(govde); }
                        else Yaz(onek == "ADIM" ? govde : satir);
                    }
                    p.WaitForExit();
                    cikis = p.ExitCode;
                }
            }
            catch (Exception ex) { hata = "Yükleyici çalıştırılamadı: " + ex.Message; Yaz(hata); }
            sonCikis = cikis;
            BeginInvoke(new Action(delegate
            {
                calisiyor = false;
                if (komut == "bul" && cikis != 0)
                {
                    oyunEtiketi.Text = "Oyun otomatik bulunamadı. \"Oyun klasörünü seç…\" düğmesiyle gösterin.";
                    oyunKlasoru = null;
                }
                DugmeleriAyarla();
                if (komut != "bul")
                {
                    if (hata != null) MessageBox.Show(hata, "Yapılamadı", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    else if (bitti && otomatik == null) { Calistir("bul"); }
                }
                if (otomatik != null && komut == otomatik) { Environment.ExitCode = cikis; Close(); }
                else if (otomatik != null && komut == "bul" && oyunKlasoru != null && !otomatikBasladi) { otomatikBasladi = true; Calistir(otomatik); }
                else if (otomatik != null && komut == "bul" && oyunKlasoru == null) { Environment.ExitCode = 2; Close(); }
            }));
        });
    }
    bool otomatikBasladi = false;

    static string DurumMetni(string d)
    {
        switch (d)
        {
            case "kurulu": return "Durum: Türkçe yama kurulu.";
            case "kurulu-degil": return "Durum: Türkçe yama kurulu değil.";
            case "yabanci": return "Durum: Yama klasöründe başka bir dosya var (dokunulmayacak).";
            default: return "Durum: " + d;
        }
    }

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        string bayrak = null;
        foreach (var a in args) { if (a == "--otomatik-kur") bayrak = "kur"; else if (a == "--otomatik-kaldir") bayrak = "kaldir"; }
        Environment.ExitCode = 0;
        Application.Run(new Pencere(bayrak));
        return Environment.ExitCode;
    }
}
