# Native engine third-party notices

The exact versions, download URLs, SHA-256 checksums and license identifiers used by the build are pinned in `native-dependencies.json`, which is bundled next to this notice.

## whisper.cpp v1.9.1 — MIT

Source: https://github.com/ggml-org/whisper.cpp/tree/v1.9.1

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## imageio-ffmpeg 0.6.0 — BSD-2-Clause

Source: https://github.com/imageio/imageio-ffmpeg/tree/v0.6.0

Copyright (c) 2019-2025, imageio

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## FFmpeg executable — GPL-2.0-or-later or GPL-3.0-or-later

The FFmpeg executable distributed by the pinned imageio-ffmpeg wheels is a separate native program. Release builds require `--enable-gpl` and reject `--enable-nonfree`. A build containing `--enable-version3` is recorded as `GPL-3.0-or-later`; other accepted builds are recorded as `GPL-2.0-or-later`, so platform differences cannot silently change the packaged license classification.

- Legal and license information: https://ffmpeg.org/legal.html
- GPL version 2 text: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
- GPL version 3 text: https://www.gnu.org/licenses/gpl-3.0.html
- FFmpeg source: https://github.com/FFmpeg/FFmpeg

FFmpeg can include additional libraries whose notices and corresponding-source obligations depend on its build configuration. Before public commercial distribution, archive the full `ffmpeg -version` configuration for every target and complete a legal review of those transitive codecs. This notice records the pinned build inputs; it is not legal advice.
