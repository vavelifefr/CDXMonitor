using System;
using System.Diagnostics;
using System.IO;

// CDXMonitor uninstaller: removes CDXMonitor files from the install folder.
// Usage: uninstall.exe [--keep-data | --remove-data] [--version]
// Without data flags it asks whether to remove user data (data/).
// Build: csc /nologo /optimize /target:exe /out:uninstall.exe uninstall.cs
sealed class Uninstall
{
    const string Version = "0.7.0";

    static int Main(string[] args)
    {
        bool wantVersion = false;
        bool wantHelp = false;
        bool removeData = false;
        bool keepData = false;
        string fromCopy = null;
        string homeRoot = null;
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--version" || a == "-v") wantVersion = true;
            else if (a == "--help" || a == "-h" || a == "/?") wantHelp = true;
            else if (a == "--remove-data") removeData = true;
            else if (a == "--keep-data") keepData = true;
            else if (a == "--from-copy" && i + 1 < args.Length) { fromCopy = args[++i]; }
            else if (a == "--home-root" && i + 1 < args.Length) { homeRoot = args[++i]; }
            else
            {
                Console.Error.WriteLine("Unknown argument: " + a);
                return 2;
            }
        }
        if (wantVersion)
        {
            Console.WriteLine("CDXMonitor uninstall " + Version);
            return 0;
        }
        if (wantHelp)
        {
            Console.WriteLine("Usage: uninstall.exe [--keep-data | --remove-data] [--home-root PATH]");
            Console.WriteLine("Removes CDXMonitor files from this folder.");
            return 0;
        }

        string dir = (fromCopy != null)
            ? fromCopy
            : AppDomain.CurrentDomain.BaseDirectory;
        if (fromCopy == null)
        {
            // A running image cannot delete itself, and the parent stays alive
            // while it waits: relaunch detached from a TEMP copy and exit at
            // once, so the staged copy can remove the original (exit code of
            // the script is shown in the console, not propagated).
            string stage = Path.Combine(Path.GetTempPath(),
                "cdxmuninstall-" + Guid.NewGuid().ToString("N"));
            try
            {
                Directory.CreateDirectory(stage);
                string self = System.Reflection.Assembly
                    .GetExecutingAssembly().Location;
                string staged = Path.Combine(stage, "uninstall.exe");
                File.Copy(self, staged, true);
                var fwd = new System.Collections.Generic.List<string>();
                fwd.Add("--from-copy"); fwd.Add(dir);
                foreach (string a in args) fwd.Add(a);
                var cpsi = new ProcessStartInfo(staged, string.Join(" ", fwd.ToArray()));
                cpsi.UseShellExecute = false;
                // TEMP, not the install dir: a process CWD locks its directory
                // and -RemoveData could not delete the install root.
                cpsi.WorkingDirectory = Path.GetTempPath();
                Process.Start(cpsi);
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Failed to stage uninstaller: " + ex.Message);
                return 1;
            }
        }

        if (!removeData && !keepData)
        {
            Console.Write("Remove user data (data/ folder) too? [y/N] ");
            string answer = (Console.ReadLine() ?? "").Trim().ToLowerInvariant();
            removeData = (answer == "y" || answer == "yes");
        }

        string ps1 = Path.Combine(dir, "uninstall.ps1");
        if (!File.Exists(ps1))
        {
            Console.Error.WriteLine("uninstall.ps1 not found next to uninstall.exe");
            return 1;
        }

        string psArgs = "-NoProfile -ExecutionPolicy Bypass -File \"" + ps1 + "\"";
        if (removeData) psArgs += " -RemoveData";
        if (homeRoot != null) psArgs += " -HomeRoot \"" + homeRoot + "\"";
        var psi = new ProcessStartInfo("powershell.exe", psArgs);
        psi.UseShellExecute = false;
        psi.WorkingDirectory = dir;
        int code;
        try
        {
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                code = p.ExitCode;
                Console.WriteLine("Uninstaller exit code: " + code);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Failed to start uninstaller: " + ex.Message);
            return 1;
        }
        if (fromCopy != null)
        {
            // Our own image lives in the stage dir: schedule deferred removal
            // (we must be gone before rd runs).
            try
            {
                string stageDir = Path.GetDirectoryName(
                    System.Reflection.Assembly.GetExecutingAssembly().Location);
                var dpsi = new ProcessStartInfo("cmd.exe",
                    "/c ping -n 3 127.0.0.1 >nul & rd /s /q \"" + stageDir + "\"");
                dpsi.UseShellExecute = false;
                dpsi.CreateNoWindow = true;
                Process.Start(dpsi);
            }
            catch { }
        }
        return code;
    }
}
