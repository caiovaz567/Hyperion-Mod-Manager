{
  "targets": [
    {
      "target_name": "usvfs_bridge",
      "sources": [ "src/addon.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<(module_root_dir)/vendor/usvfs_v0.5.7.2/include"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "WIN32_LEAN_AND_MEAN",
        "NOMINMAX",
        "UNICODE",
        "_UNICODE"
      ],
      "library_dirs": [ "<(module_root_dir)/vendor/usvfs_v0.5.7.2/lib" ],
      "libraries": [ "usvfs_x64.lib", "delayimp.lib" ],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1 },
        "VCLinkerTool": {
          "DelayLoadDLLs": [ "usvfs_x64.dll" ]
        }
      },
      "copies": [
        {
          "destination": "<(module_root_dir)/build/Release",
          "files": [
            "<(module_root_dir)/vendor/usvfs_v0.5.7.2/bin/usvfs_x64.dll",
            "<(module_root_dir)/vendor/usvfs_v0.5.7.2/bin/usvfs_proxy_x64.exe"
          ]
        }
      ],
      "conditions": [
        [ "OS!=\"win\"", { "type": "none" } ]
      ]
    }
  ]
}
