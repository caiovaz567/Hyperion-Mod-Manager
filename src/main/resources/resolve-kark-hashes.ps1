param(
  [Parameter(Mandatory = $true)]
  [string]$KarkPath,

  [Parameter(Mandatory = $true)]
  [string]$OodlePath,

  [Parameter(Mandatory = $true)]
  [string]$Hashes
)

$ErrorActionPreference = 'Stop'

if (
  -not (Test-Path -LiteralPath $KarkPath) -or
  -not (Test-Path -LiteralPath $OodlePath) -or
  $Hashes.Trim().Length -eq 0
) {
  Write-Output '{}'
  exit 0
}

$escapedOodlePath = $OodlePath.Replace('\', '\\').Replace('"', '\"')

$source = @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class HyperionKarkHashResolver
{
    [DllImport("__OODLE_PATH__", EntryPoint = "OodleLZ_Decompress", CallingConvention = CallingConvention.StdCall)]
    private static extern int OodleLZDecompress(
        byte[] compBuf,
        long compBufSize,
        byte[] rawBuf,
        long rawLen,
        int fuzzSafe,
        int checkCrc,
        int verbosity,
        IntPtr decBufBase,
        long decBufSize,
        IntPtr fpCallback,
        IntPtr callbackUserData,
        IntPtr decoderMemory,
        long decoderMemorySize,
        int threadModule
    );

    public static string Resolve(string karkPath, string[] targetHashes)
    {
        try
        {
            HashSet<string> targets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string hash in targetHashes)
            {
                string normalized = NormalizeHash(hash);
                if (normalized.Length > 0)
                {
                    targets.Add(normalized);
                }
            }

            if (targets.Count == 0)
            {
                return "{}";
            }

            byte[] raw = ReadKark(karkPath);
            Dictionary<string, string> matches = FindMatches(raw, targets);
            return ToJson(matches);
        }
        catch
        {
            return "{}";
        }
    }

    private static string NormalizeHash(string value)
    {
        if (value == null)
        {
            return "";
        }

        string normalized = value.Trim().ToLowerInvariant();
        if (normalized.StartsWith("0x"))
        {
            normalized = normalized.Substring(2);
        }

        if (normalized.Length == 0 || normalized.Length > 16)
        {
            return "";
        }

        foreach (char ch in normalized)
        {
            bool isHex = (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f');
            if (!isHex)
            {
                return "";
            }
        }

        return normalized.PadLeft(16, '0');
    }

    private static byte[] ReadKark(string karkPath)
    {
        byte[] fileBytes = File.ReadAllBytes(karkPath);
        if (
            fileBytes.Length < 8 ||
            fileBytes[0] != 0x4B ||
            fileBytes[1] != 0x41 ||
            fileBytes[2] != 0x52 ||
            fileBytes[3] != 0x4B
        )
        {
            return fileBytes;
        }

        int rawSize = BitConverter.ToInt32(fileBytes, 4);
        if (rawSize <= 0)
        {
            return new byte[0];
        }

        byte[] compressed = new byte[fileBytes.Length - 8];
        Buffer.BlockCopy(fileBytes, 8, compressed, 0, compressed.Length);

        byte[] raw = new byte[rawSize];
        int result = OodleLZDecompress(
            compressed,
            compressed.Length,
            raw,
            raw.Length,
            1,
            0,
            0,
            IntPtr.Zero,
            0,
            IntPtr.Zero,
            IntPtr.Zero,
            IntPtr.Zero,
            0,
            3
        );

        return result > 0 ? raw : new byte[0];
    }

    private static Dictionary<string, string> FindMatches(byte[] raw, HashSet<string> targets)
    {
        Dictionary<string, string> matches = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        Encoding encoding = Encoding.UTF8;
        int start = 0;

        for (int index = 0; index <= raw.Length; index++)
        {
            bool atEnd = index == raw.Length;
            bool atLineBreak = !atEnd && (raw[index] == 10 || raw[index] == 13 || raw[index] == 0);
            if (!atEnd && !atLineBreak)
            {
                continue;
            }

            if (index > start)
            {
                string path = NormalizePath(encoding.GetString(raw, start, index - start));
                if (path.Length > 0)
                {
                    AddIfMatch(matches, targets, path);
                    if (matches.Count == targets.Count)
                    {
                        return matches;
                    }
                }
            }

            while (index + 1 < raw.Length && (raw[index + 1] == 10 || raw[index + 1] == 13 || raw[index + 1] == 0))
            {
                index++;
            }
            start = index + 1;
        }

        return matches;
    }

    private static void AddIfMatch(Dictionary<string, string> matches, HashSet<string> targets, string path)
    {
        string backslashPath = path.Replace('/', '\\');
        string lowercaseBackslashPath = backslashPath.ToLowerInvariant();
        string slashPath = path.Replace('\\', '/');
        string lowercaseSlashPath = slashPath.ToLowerInvariant();

        string[] candidates = new string[]
        {
            backslashPath,
            lowercaseBackslashPath,
            slashPath,
            lowercaseSlashPath
        };

        foreach (string candidate in candidates)
        {
            string hash = CalculateFnv1A64(candidate);
            if (targets.Contains(hash) && !matches.ContainsKey(hash))
            {
                matches[hash] = slashPath;
            }
        }
    }

    private static string NormalizePath(string value)
    {
        return value.Trim().Replace('\\', '/').Trim('/');
    }

    private static string CalculateFnv1A64(string value)
    {
        const ulong Offset = 14695981039346656037UL;
        const ulong Prime = 1099511628211UL;
        ulong hash = Offset;
        byte[] bytes = Encoding.UTF8.GetBytes(value);

        unchecked
        {
            foreach (byte byteValue in bytes)
            {
                hash ^= (ulong)(sbyte)byteValue;
                hash *= Prime;
            }
        }

        return hash.ToString("x16");
    }

    private static string ToJson(Dictionary<string, string> matches)
    {
        StringBuilder json = new StringBuilder();
        json.Append("{");
        bool first = true;

        foreach (KeyValuePair<string, string> entry in matches)
        {
            if (!first)
            {
                json.Append(",");
            }

            first = false;
            json.Append("\"");
            json.Append(EscapeJson(entry.Key));
            json.Append("\":\"");
            json.Append(EscapeJson(entry.Value));
            json.Append("\"");
        }

        json.Append("}");
        return json.ToString();
    }

    private static string EscapeJson(string value)
    {
        StringBuilder escaped = new StringBuilder();

        foreach (char ch in value)
        {
            switch (ch)
            {
                case '\\':
                    escaped.Append("\\\\");
                    break;
                case '"':
                    escaped.Append("\\\"");
                    break;
                case '\b':
                    escaped.Append("\\b");
                    break;
                case '\f':
                    escaped.Append("\\f");
                    break;
                case '\n':
                    escaped.Append("\\n");
                    break;
                case '\r':
                    escaped.Append("\\r");
                    break;
                case '\t':
                    escaped.Append("\\t");
                    break;
                default:
                    if (ch < 32 || ch > 126)
                    {
                        escaped.Append("\\u");
                        escaped.Append(((int)ch).ToString("x4"));
                    }
                    else
                    {
                        escaped.Append(ch);
                    }
                    break;
            }
        }

        return escaped.ToString();
    }
}
"@

$source = $source.Replace('__OODLE_PATH__', $escapedOodlePath)
Add-Type -TypeDefinition $source -Language CSharp
$hashList = $Hashes -split '[,\s;]+' | Where-Object { $_.Trim().Length -gt 0 }
[HyperionKarkHashResolver]::Resolve($KarkPath, $hashList)
