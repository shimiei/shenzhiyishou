# 第三方组件与许可

这个程序用了别人的东西，这里把清单、出处和许可以及需要随附的声明一并写清。安装包与便携版里附带的是第一栏那几项；只在开发、打包时用到的在第二栏，它们不进安装包。

## 随包分发的

| 组件 | 版本 | 许可 | 用在哪 |
| --- | --- | --- | --- |
| Electron | 33.4.11 | MIT | 整个程序的运行环境（Chromium 加 Node） |
| Chromium 及其它组件 | 随 Electron 33 | BSD 3-Clause 等 | Electron 内置；完整声明随包另附 |
| React / React DOM | 18.3.1 | MIT | 界面 |
| zustand | 4.5.7 | MIT | 界面状态 |
| KataGo | 1.18.1 | MIT | 引擎 `engine/katago.exe` 与 opencl、eigenavx2 两个后端 |
| KataGo 网络 b6c96-s175395328-d26788732 | 训练步 175395328 | KataGo Neural Network License | 随包带着的轻量网络，约 4.8 MB |
| KataGo 网络 kata1-b18c384nbt-s9996604416-d4316597426 | 训练步 9996604416 | KataGo Neural Network License | 程序里可以下载 |
| KataGo 网络 kata1-b28c512nbt-s13255194368-d5935380940 | 训练步 13255194368 | KataGo Neural Network License | 程序里可以下载 |
| KataGo 人味网络 b18c384nbt-humanv0 | 官方发布 | KataGo Neural Network License | 程序里可以下载 |

出处：

- KataGo 引擎：<https://github.com/lightvector/KataGo>（v1.18.1 的 win64 发布包）
- 网络：<https://katagotraining.org>（随包的小网络取自这里；`kata1-b18c384nbt` 与 `kata1-b28c512nbt` 的下载地址写在 `src/main/models.ts` 的 `MODEL_DEFS` 里）
- 网络许可的原文与例外：<https://katagotraining.org/network_license/>

那个页面上的规则，简要地说：挂在 kata1 里的官方网络按 KataGo Neural Network License 发布，可以自由使用、复制、修改、再分发甚至出售，条件是把版权声明与许可声明一并保留；更早的 g170 那一批是 CC0，等于公有领域；网站上由别人贡献的网络不在这份许可里。随包的小网络（b6c96-s175395328-d26788732）按 KataGo Neural Network License 对待，所以下面把全文附上，安装包里也带着这一份说明。

引擎与网络都不在 git 仓库里（体积大，而且都能公开下载），它们出现在安装包、便携版和程序自己的运行目录里；仓库里只有随包小网络的权重文件 `models/b6c96-s175395328-d26788732/model.txt.gz`。

## 只在开发与打包时用

这些只装在开发机上，构建产物里不含它们的代码，安装包里也没有：

| 组件 | 版本 | 许可 |
| --- | --- | --- |
| TypeScript | 5.9 | Apache-2.0 |
| Vite | 5.4 | MIT |
| esbuild | 0.21 | MIT |
| electron-builder | 25.1 | MIT |
| cross-env | 7.0 | MIT |
| @vitejs/plugin-react | 4.7 | MIT |
| @types/node、@types/react、@types/react-dom | 22 / 18 | MIT |

## 本项目的许可

MIT，全文在仓库根目录的 `LICENSE`。规则引擎、棋谱解析、棋盘识别、复盘这些算法都是这个程序自己写的，没有引用别人的实现。

## 许可全文

### MIT（本项目，以及 Electron、React、React DOM、zustand、KataGo 引擎）

```
MIT License

Copyright (c) 2026 shimiei
（Electron、React、React DOM、zustand、KataGo 各自的版权声明见它们自己的发行包）

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

KataGo 本身的版权行是：

```
Copyright 2025 David J Wu ("lightvector") and/or other authors of the content in this repository.
```

### KataGo Neural Network License（随包的小网络与可下载的那几个网络）

```
KataGo Neural Network License

Copyright 2026 David J Wu ("lightvector").

Permission is hereby granted, free of charge, to any person obtaining a copy of the neural net files or training weight files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### Electron 与 Chromium

Electron 自带的声明随包放在安装目录里，与 `神之一手.exe` 同一层的 `resources` 旁边：

- `LICENSE.electron.txt`：Electron 自己的 MIT 许可与版权行
- `LICENSES.chromium.html`：Chromium 及 Electron 里其它第三方组件的完整声明
