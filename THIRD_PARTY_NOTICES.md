# Third-party software

Bedazzle's application code is Apache-2.0 licensed; see `LICENSE`.

The ready-to-run Windows release bundles:

| Component | Source | License in the release |
| --- | --- | --- |
| Python 3.14.10, Windows x86-64 embedded runtime | https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip | `runtime/python/LICENSE.txt` |
| DuckDB 2.0.0, cp312-abi3 Windows x86-64 wheel | Official `duckdb` package from PyPI / files.pythonhosted.org | `runtime/engine/duckdb-2.0.0.dist-info/licenses/LICENSE` |
| Pillow 13.0.0, cp314 Windows x86-64 wheel | Official `pillow` package from PyPI / files.pythonhosted.org | `runtime/engine/pillow-13.0.0.dist-info/licenses/LICENSE` (including bundled codec notices); SBOM in `sboms/` |

Pinned archive SHA-256 checksums:

- Python: `90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159`
- DuckDB: `f61c96547ed432f54dae42a717fd88563eda55cb47549715fac9f61f770c205a`
- Pillow, bundled cp314 wheel: `f7cbb7a64e7ec664775195e4f81923bc8a93d9451b963f844e59118f63147a7a`

The source bootstrap also pins official Pillow 13.0.0 cp312/cp313/cp315 Windows wheel URLs and SHA-256 values for compatible installed Python versions; see `PILLOW_WHEELS` in bootstrap.py. Pillow is used for in-process image inspection; SVG scripts and EPS/PDF external executables are not used. Its image APIs and safeguards are documented at https://pillow.readthedocs.io/en/stable/reference/Image.html and https://pillow.readthedocs.io/en/stable/handbook/security.html.

The source-only launcher downloads these same artifacts on first use and verifies their hashes. The embedded Python path file is configured to find the app and engine; system Python/settings are unchanged. Source history excludes runtime binaries. The current app does not need or ship the earlier DuckLocal executable or its source checkout.

Playwright and Chromium are test-only dependencies, excluded from source/release artifacts. The UI uses fonts available on the user's system and its own HTML/CSS/SVG; no external font/script/CDN is required.
