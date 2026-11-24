# 海景插画

浅色的 Honu Lagoon 和深色的 Night Reef 来自 Anthropic 的 `theme-examples` 插件。这里保留了两份原始 TypeScript 场景生成器，用它们生成的 SVG 作为 Antigravity 背景。生成器及场景按照 Apache License 2.0 分发。[上游源码，固定提交](https://github.com/anthropics/claude-plugins-official/tree/5cec6716767283f4675a05f5f8855b5b49c81783/plugins/theme-examples/hooks/scenes) · [许可证](LICENSE)

安装时直接使用仓库中的两个 SVG。从项目根目录执行以下命令可重新生成它们，需要 Node.js 22.13 或更高版本。

```sh
cd theme/scenes
node --experimental-strip-types --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { honuLagoonSvg } from './honu-lagoon.ts';
import { nightReefSvg } from './night-reef.ts';

writeFileSync('honu-lagoon.svg', honuLagoonSvg());
writeFileSync('night-reef.svg', nightReefSvg());
JS
```
