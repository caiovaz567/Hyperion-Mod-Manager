// usvfs-bridge - native bridge between Hyperion (Electron/Node) and usvfs.
//
// PHASE 3a: the real lifecycle the app will use.
//   mountVfs({ instanceName, links: [{source, dest}] })
//       create a VFS and virtually link library files over the game tree.
//       The VFS stays alive (this process is the controller) until unmountVfs().
//   launchHookedProcess({ appPath, commandLine, cwd, capture, waitMs })
//       spawn a process hooked into the mounted VFS. With capture+wait it
//       returns stdout/exitCode (validation); for the real game, no capture and
//       waitMs:0 returns the pid and lets it run.
//   unmountVfs()
//       tear the VFS down (call when the game exits).
//
// Links are applied in array order; a later link to the same dest wins, which
// maps to Hyperion's "higher load order overrides".
//
// usvfs_x64.dll is delay-loaded and explicitly loaded from this addon's own
// directory (default DLL search resolves relative to electron.exe, not us).

#include <napi.h>
#include <windows.h>
#include <string>
#include <vector>
#include "usvfs/usvfs.h"

namespace {

bool g_mounted = false;

bool EnsureUsvfsLoaded() {
  static bool tried = false;
  static bool ok = false;
  if (tried) return ok;
  tried = true;

  HMODULE self = nullptr;
  if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                              GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                          reinterpret_cast<LPCWSTR>(&EnsureUsvfsLoaded), &self)) {
    return false;
  }
  wchar_t path[MAX_PATH];
  DWORD n = GetModuleFileNameW(self, path, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) return false;
  for (DWORD i = n; i > 0; --i) {
    if (path[i - 1] == L'\\' || path[i - 1] == L'/') {
      path[i] = 0;
      break;
    }
  }
  std::wstring dll = std::wstring(path) + L"usvfs_x64.dll";
  ok = LoadLibraryExW(dll.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH) != nullptr;
  return ok;
}

std::wstring ToWide(const Napi::Value& v) {
  std::u16string s = v.As<Napi::String>().Utf16Value();
  return std::wstring(s.begin(), s.end());
}

Napi::Object Fail(Napi::Env env, const std::string& stage, DWORD gle) {
  Napi::Object r = Napi::Object::New(env);
  r.Set("ok", false);
  r.Set("stage", stage);
  r.Set("gle", Napi::Number::New(env, static_cast<double>(gle)));
  return r;
}

bool LoadGuard(Napi::Env env) {
  if (EnsureUsvfsLoaded()) return true;
  Napi::Error::New(env, "failed to load usvfs_x64.dll").ThrowAsJavaScriptException();
  return false;
}

Napi::Value Hello(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "usvfs-bridge alive (phase 3a)");
}

Napi::Value UsvfsVersion(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!LoadGuard(env)) return env.Null();
  const char* v = usvfsVersionString();
  return Napi::String::New(env, v ? v : "");
}

// mountVfs({ instanceName, links: [{source, dest}] }) -> { ok } | { ok:false,... }
Napi::Value MountVfs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!LoadGuard(env)) return env.Null();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "expected options object").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Object opts = info[0].As<Napi::Object>();
  std::string instanceName = opts.Has("instanceName")
                                 ? opts.Get("instanceName").As<Napi::String>().Utf8Value()
                                 : "hyperion_vfs";

  // Note: we do NOT call usvfsDisconnectVFS here. usvfsCreateVFS resets the VFS,
  // and disconnecting a VFS that has a CREATETARGET link crashes usvfs 0.5.7.2.
  g_mounted = false;

  usvfsParameters* params = usvfsCreateParameters();
  if (!params) return Fail(env, "createParameters", GetLastError());
  usvfsSetInstanceName(params, instanceName.c_str());
  usvfsSetDebugMode(params, FALSE);
  usvfsSetLogLevel(params, LogLevel::Error);
  usvfsSetCrashDumpType(params, CrashDumpsType::None);

  BOOL created = usvfsCreateVFS(params);
  usvfsFreeParameters(params);
  if (!created) return Fail(env, "createVFS", GetLastError());
  g_mounted = true;

  usvfsClearExecutableBlacklist();
  if (opts.Has("blacklistExecutables") && opts.Get("blacklistExecutables").IsArray()) {
    Napi::Array blacklist = opts.Get("blacklistExecutables").As<Napi::Array>();
    for (uint32_t i = 0; i < blacklist.Length(); ++i) {
      Napi::Value value = blacklist.Get(i);
      if (!value.IsString()) continue;
      std::wstring executableName = ToWide(value);
      if (!executableName.empty()) usvfsBlacklistExecutable(executableName.c_str());
    }
  }

  // Library bookkeeping files must never leak into the game tree via directory
  // links.
  usvfsClearSkipFileSuffixes();
  usvfsAddSkipFileSuffix(L"_metadata.json");
  usvfsAddSkipFileSuffix(L"_archive_resources.json");

  // Reset any forced-library registrations from a previous mount; the caller
  // re-adds them (forceLoadLibrary) before launching the hooked process.
  usvfsClearLibraryForceLoads();

  unsigned int linked = 0;
  unsigned int failed = 0;
  if (opts.Has("links") && opts.Get("links").IsArray()) {
    Napi::Array links = opts.Get("links").As<Napi::Array>();
    for (uint32_t i = 0; i < links.Length(); ++i) {
      Napi::Value lv = links.Get(i);
      if (!lv.IsObject()) continue;
      Napi::Object link = lv.As<Napi::Object>();
      std::wstring source = ToWide(link.Get("source"));
      std::wstring dest = ToWide(link.Get("dest"));
      const bool isDir = link.Has("dir") && link.Get("dir").ToBoolean().Value();
      // createTarget redirects file creation/writes in `dest` to `source` - used
      // for a writable overwrite folder so mods/the game can write logs, configs
      // and caches (e.g. red4ext/logs, r6/cache) into virtual game folders.
      const bool createTarget =
          link.Has("createTarget") && link.Get("createTarget").ToBoolean().Value();

      // createTarget links establish a write-redirect for the destination; they
      // are not recursive read overlays (usvfsDisconnectVFS crashes on a
      // RECURSIVE|CREATETARGET directory link in usvfs 0.5.7.2).
      unsigned int dirFlags = createTarget ? LINKFLAG_CREATETARGET : LINKFLAG_RECURSIVE;
      unsigned int fileFlags = createTarget ? LINKFLAG_CREATETARGET : 0;

      // A later link to the same dest overrides an earlier one (load-order
      // priority). Directory links recurse and create the virtual tree, so files
      // landing in folders that don't physically exist in the game still appear.
      BOOL ok = isDir
                    ? usvfsVirtualLinkDirectoryStatic(source.c_str(), dest.c_str(), dirFlags)
                    : usvfsVirtualLinkFile(source.c_str(), dest.c_str(), fileFlags);
      if (ok) {
        ++linked;
      } else {
        ++failed;
      }
    }
  }

  Napi::Object r = Napi::Object::New(env);
  r.Set("ok", true);
  r.Set("linked", Napi::Number::New(env, static_cast<double>(linked)));
  r.Set("failed", Napi::Number::New(env, static_cast<double>(failed)));
  return r;
}

// launchHookedProcess({ appPath, commandLine, cwd?, capture?, waitMs? })
//   -> { ok, pid, exitCode?, stdout? } | { ok:false, stage, gle }
Napi::Value LaunchHookedProcess(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!LoadGuard(env)) return env.Null();
  if (!g_mounted) {
    Napi::Error::New(env, "VFS not mounted").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "expected options object").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Object opts = info[0].As<Napi::Object>();

  std::wstring appPath = opts.Has("appPath") ? ToWide(opts.Get("appPath")) : L"";
  std::wstring commandLine = ToWide(opts.Get("commandLine"));
  std::wstring cwd = opts.Has("cwd") ? ToWide(opts.Get("cwd")) : L"";
  bool capture = opts.Has("capture") && opts.Get("capture").ToBoolean().Value();
  DWORD waitMs = opts.Has("waitMs")
                     ? static_cast<DWORD>(opts.Get("waitMs").As<Napi::Number>().Int64Value())
                     : 0;

  std::vector<wchar_t> cmdBuf(commandLine.begin(), commandLine.end());
  cmdBuf.push_back(0);
  const wchar_t* appPtr = appPath.empty() ? nullptr : appPath.c_str();
  const wchar_t* cwdPtr = cwd.empty() ? nullptr : cwd.c_str();

  STARTUPINFOW si{};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi{};
  DWORD creationFlags = 0;

  HANDLE hRead = nullptr, hWrite = nullptr, hNulIn = INVALID_HANDLE_VALUE;
  BOOL inherit = FALSE;
  if (capture) {
    SECURITY_ATTRIBUTES sa{};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;
    if (!CreatePipe(&hRead, &hWrite, &sa, 0)) return Fail(env, "createPipe", GetLastError());
    SetHandleInformation(hRead, HANDLE_FLAG_INHERIT, 0);
    hNulIn = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ, &sa, OPEN_EXISTING, 0, nullptr);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = hNulIn;
    si.hStdOutput = hWrite;
    si.hStdError = hWrite;
    creationFlags = CREATE_NO_WINDOW;
    inherit = TRUE;
  }

  BOOL spawned = usvfsCreateProcessHooked(appPtr, cmdBuf.data(), nullptr, nullptr,
                                          inherit, creationFlags, nullptr, cwdPtr,
                                          &si, &pi);
  DWORD spawnGle = GetLastError();
  if (hWrite) CloseHandle(hWrite);
  if (hNulIn != INVALID_HANDLE_VALUE) CloseHandle(hNulIn);

  if (!spawned) {
    if (hRead) CloseHandle(hRead);
    return Fail(env, "createProcessHooked", spawnGle);
  }

  std::string out;
  if (capture) {
    char buf[4096];
    DWORD got = 0;
    while (ReadFile(hRead, buf, sizeof(buf), &got, nullptr) && got > 0) out.append(buf, got);
    CloseHandle(hRead);
  }

  DWORD exitCode = STILL_ACTIVE;
  if (waitMs > 0) {
    WaitForSingleObject(pi.hProcess, waitMs);
    GetExitCodeProcess(pi.hProcess, &exitCode);
  }

  DWORD pid = pi.dwProcessId;
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);

  Napi::Object r = Napi::Object::New(env);
  r.Set("ok", true);
  r.Set("pid", Napi::Number::New(env, static_cast<double>(pid)));
  if (waitMs > 0) r.Set("exitCode", Napi::Number::New(env, static_cast<double>(exitCode)));
  if (capture) r.Set("stdout", out);
  return r;
}

Napi::Value UnmountVfs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // We intentionally do NOT call usvfsDisconnectVFS: it crashes usvfs 0.5.7.2
  // when a CREATETARGET (overwrite) link is active. Leaving the VFS resident is
  // harmless once the game has exited - no other process is hooked into it - and
  // the next mountVfs resets it via usvfsCreateVFS. The OS reclaims everything
  // when the controller (main) process exits.
  if (EnsureUsvfsLoaded() && g_mounted) {
    usvfsClearVirtualMappings();
    usvfsClearExecutableBlacklist();
    g_mounted = false;
  }
  Napi::Object r = Napi::Object::New(env);
  r.Set("ok", true);
  return r;
}

// dumpVfsTree() -> string. Readable view of the current virtual mappings.
Napi::Value DumpVfsTree(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!LoadGuard(env)) return env.Null();
  if (!g_mounted) return Napi::String::New(env, "(not mounted)");
  size_t size = 0;
  usvfsCreateVFSDump(nullptr, &size);
  if (size == 0) return Napi::String::New(env, "(empty)");
  std::vector<char> buf(size + 1, 0);
  usvfsCreateVFSDump(buf.data(), &size);
  return Napi::String::New(env, std::string(buf.data(), size));
}

// forceLoadLibrary(processName, libraryPath) -> { ok }
// Register a DLL to be force-loaded (through the VFS) when usvfs injects the
// named process. This is how import-time proxy/loader DLLs (CET's version.dll,
// RED4ext's winmm.dll) load from a VIRTUAL bin/x64 - usvfs loads them while its
// hooks are active, so the module binds to the virtual file, and the game's
// static import then resolves to the already-loaded module. No physical staging
// into the game folder, so no admin is needed. Call after mountVfs and before
// launchHookedProcess. libraryPath should be the virtual game-relative path
// (e.g. <gameRoot>\bin\x64\version.dll) so the module appears loaded from there.
Napi::Value ForceLoadLibrary(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!LoadGuard(env)) return env.Null();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "expected (processName, libraryPath)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::wstring processName = ToWide(info[0]);
  std::wstring libraryPath = ToWide(info[1]);
  usvfsForceLoadLibrary(processName.c_str(), libraryPath.c_str());
  Napi::Object r = Napi::Object::New(env);
  r.Set("ok", true);
  return r;
}

// clearForcedLibraries() -> { ok }. Drop all forceLoadLibrary registrations.
Napi::Value ClearForcedLibraries(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!LoadGuard(env)) return env.Null();
  usvfsClearLibraryForceLoads();
  Napi::Object r = Napi::Object::New(env);
  r.Set("ok", true);
  return r;
}

// vfsProcesses() -> number[]. PIDs currently connected to (hooked into) the VFS.
Napi::Value VfsProcesses(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!LoadGuard(env)) return env.Null();
  size_t count = 0;
  DWORD* buffer = nullptr;
  Napi::Array out = Napi::Array::New(env);
  if (g_mounted && usvfsGetVFSProcessList2(&count, &buffer) && buffer) {
    for (size_t i = 0; i < count; ++i) {
      out.Set(static_cast<uint32_t>(i), Napi::Number::New(env, static_cast<double>(buffer[i])));
    }
    free(buffer);
  }
  return out;
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("hello", Napi::Function::New(env, Hello));
  exports.Set("usvfsVersion", Napi::Function::New(env, UsvfsVersion));
  exports.Set("mountVfs", Napi::Function::New(env, MountVfs));
  exports.Set("launchHookedProcess", Napi::Function::New(env, LaunchHookedProcess));
  exports.Set("unmountVfs", Napi::Function::New(env, UnmountVfs));
  exports.Set("forceLoadLibrary", Napi::Function::New(env, ForceLoadLibrary));
  exports.Set("clearForcedLibraries", Napi::Function::New(env, ClearForcedLibraries));
  exports.Set("dumpVfsTree", Napi::Function::New(env, DumpVfsTree));
  exports.Set("vfsProcesses", Napi::Function::New(env, VfsProcesses));
  return exports;
}

NODE_API_MODULE(usvfs_bridge, Init)
