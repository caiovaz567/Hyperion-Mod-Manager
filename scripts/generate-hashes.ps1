param(
  [string]$GamePath = "E:\SteamLibrary\steamapps\common\Cyberpunk 2077",
  [string]$OutputPath = "$PSScriptRoot\..\src\main\resources\hashes.csv.gz"
)

$ErrorActionPreference = 'Stop'

$ArchiveDir = Join-Path $GamePath "archive\pc\content"
$OodlePath  = Join-Path $GamePath "bin\x64\oo2ext_7_win64.dll"

if (-not (Test-Path -LiteralPath $ArchiveDir)) { Write-Error "Archive dir not found: $ArchiveDir"; exit 1 }
if (-not (Test-Path -LiteralPath $OodlePath))  { Write-Error "Oodle DLL not found: $OodlePath"; exit 1 }

$escapedOodlePath = $OodlePath.Replace('\', '\\').Replace('"', '\"')

$source = @"
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text;

public static class HyperionHashGenerator
{
    private const int    FooterHeaderSize  = 20;
    private const ulong  FNV1A64_OFFSET    = 14695981039346656037UL;
    private const ulong  FNV1A64_PRIME     = 1099511628211UL;

    [DllImport("__OODLE_PATH__", EntryPoint = "OodleLZ_Decompress", CallingConvention = CallingConvention.StdCall)]
    private static extern int OodleLZDecompress(
        byte[] compBuf, long compBufSize,
        byte[] rawBuf,  long rawLen,
        int fuzzSafe, int checkCrc, int verbosity,
        IntPtr decBufBase, long decBufSize,
        IntPtr fpCallback, IntPtr callbackUserData,
        IntPtr decoderMemory, long decoderMemorySize,
        int threadModule
    );

    private static string Fnv1a64(string value)
    {
        ulong hash = FNV1A64_OFFSET;
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        unchecked { foreach (byte b in bytes) { hash ^= (ulong)(sbyte)b; hash *= FNV1A64_PRIME; } }
        return hash.ToString("x16");
    }

    private static byte[] ReadHead(string path)
    {
        using (FileStream fs = File.OpenRead(path))
        {
            int n = (int)Math.Min(fs.Length, 2 * 1024 * 1024);
            byte[] buf = new byte[n];
            int read = fs.Read(buf, 0, n);
            if (read == n) return buf;
            byte[] t = new byte[read]; Buffer.BlockCopy(buf, 0, t, 0, read); return t;
        }
    }

    private static int FindLxrs(byte[] data)
    {
        for (int i = 0; i <= data.Length - 4; i++)
            if (data[i]==0x53 && data[i+1]==0x52 && data[i+2]==0x58 && data[i+3]==0x4C) return i;
        return -1;
    }

    private static List<string> ReadNullTerminated(byte[] data, int count)
    {
        var enc   = Encoding.GetEncoding(28591);
        var paths = new List<string>();
        int start = 0;
        for (int i = 0; i < data.Length && paths.Count < count; i++)
        {
            if (data[i] != 0) continue;
            if (i > start) paths.Add(enc.GetString(data, start, i - start));
            start = i + 1;
        }
        if (paths.Count < count && start < data.Length)
            paths.Add(enc.GetString(data, start, data.Length - start));
        return paths;
    }

    public static List<string> ExtractPaths(string archivePath)
    {
        try
        {
            byte[] head = ReadHead(archivePath);
            int off = FindLxrs(head);
            if (off < 0 || off + FooterHeaderSize > head.Length) return new List<string>();

            int rawSize        = BitConverter.ToInt32(head, off + 8);
            int compressedSize = BitConverter.ToInt32(head, off + 12);
            int fileCount      = BitConverter.ToInt32(head, off + 16);
            int payloadOffset  = off + FooterHeaderSize;

            if (rawSize <= 0 || compressedSize <= 0 || fileCount <= 0 || fileCount > 500000
                || payloadOffset + compressedSize > head.Length)
                return new List<string>();

            byte[] payload = new byte[compressedSize];
            Buffer.BlockCopy(head, payloadOffset, payload, 0, compressedSize);

            byte[] raw;
            if (rawSize > compressedSize)
            {
                raw = new byte[rawSize];
                int r = OodleLZDecompress(payload, payload.Length, raw, raw.Length,
                    1, 0, 0, IntPtr.Zero, 0, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, 3);
                if (r <= 0) return new List<string>();
            }
            else { raw = payload; }

            return ReadNullTerminated(raw, fileCount);
        }
        catch { return new List<string>(); }
    }

    public static void Generate(string archiveDir, string outputPath)
    {
        string[] archives = Directory.GetFiles(archiveDir, "*.archive", SearchOption.TopDirectoryOnly);
        var hashMap = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (string archive in archives)
        {
            string name = Path.GetFileName(archive);
            Console.Write("  " + name + " ... ");
            var paths = ExtractPaths(archive);
            int added = 0;

            foreach (string raw in paths)
            {
                string slash     = raw.Replace('\\', '/').Trim('/');
                if (slash.Length == 0) continue;
                string backslash  = slash.Replace('/', '\\');
                string lSlash     = slash.ToLowerInvariant();
                string lBackslash = backslash.ToLowerInvariant();

                foreach (string variant in new[]{ backslash, lBackslash, slash, lSlash })
                {
                    string hash = Fnv1a64(variant);
                    if (!hashMap.ContainsKey(hash)) { hashMap[hash] = lSlash; added++; }
                }
            }

            Console.WriteLine(paths.Count + " paths  +" + added + " hashes");
        }

        Console.WriteLine();
        Console.WriteLine("Total unique hash entries: " + hashMap.Count);

        var sb = new System.Text.StringBuilder(hashMap.Count * 60);
        foreach (var kv in hashMap) { sb.Append(kv.Key); sb.Append(','); sb.AppendLine(kv.Value); }
        byte[] csv = Encoding.UTF8.GetBytes(sb.ToString());

        string dir = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        using (var fs = File.Create(outputPath))
        using (var gz = new GZipStream(fs, CompressionLevel.Optimal))
            gz.Write(csv, 0, csv.Length);

        long sizeKb = new FileInfo(outputPath).Length / 1024;
        Console.WriteLine("Written: " + outputPath + " (" + sizeKb + " KB)");
    }
}
"@

$source = $source.Replace('__OODLE_PATH__', $escapedOodlePath)
Add-Type -TypeDefinition $source -Language CSharp

$out = [System.IO.Path]::GetFullPath($OutputPath)
Write-Host ""
Write-Host "Generating hashes.csv.gz from: $ArchiveDir"
Write-Host "Output: $out"
Write-Host ""

[HyperionHashGenerator]::Generate($ArchiveDir, $out)
