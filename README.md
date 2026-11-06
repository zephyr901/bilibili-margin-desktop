# 映间 MARGIN 桌面适配

把映间的首页、主题与快捷操作接入 B 站 Windows 客户端的社区项目。桌面适配源码免费开放，采用 MIT 许可证。 [许可证](LICENSE)

本项目使用并改编了 **jiuyang5354** 开发的网页版浏览器扩展 **映间 MARGIN v0.52.0**。首页、设置、卡片、天气、动态背景及相关交互来自上游。桌面端新增了原生窗口与搜索的适配、搜索粒子、小窗还原与关闭、回复树接入和本地打包脚本。感谢原作者和上游贡献者。 [上游仓库](https://github.com/jiuyang5354/bilibili-margin) · [v0.52.0 发行版](https://github.com/jiuyang5354/bilibili-margin/releases/tag/v0.52.0) · [源码出处与变更](third_party/margin/README.md)

## 功能

- 搜索结果保留映间亮色或暗色主题，并保留 B 站搜索的分类和排序。屏蔽规则可以过滤结果中的视频卡片。
- 沿用原生播放器、弹幕、清晰度和互动入口。支持手动进入小窗、直接还原或关闭，以及映间样式的评论回复树。
- 首页沿用映间推荐、热门、动态背景、天气、足迹和设置界面。设置与足迹可以用 JSON 备份迁移。
- 客户端资料保存在独立的 Windows 用户目录。账号相关功能使用各设备自己的登录状态。

实测范围和需要登录的功能见 [功能验收](desktop-port/release/功能验收.md)。

## 在本地生成桌面版

需要 Windows x64、PowerShell 7.2 或更新版本、Node.js 24 或更新版本，以及本机安装的 **B 站 Windows x64 客户端 1.17.6（1.17.6.4728）**。脚本会检查客户端 `resources/app.asar` 的 SHA-256。 [对应版本的官方安装包](https://dl.hdslb.com/mobile/pack/bili_win/23743424/public/bilibili-setup-v1.17.6.exe) · [WinGet 版本清单](https://github.com/microsoft/winget-pkgs/blob/master/manifests/b/Bilibili/Bilibili/1.17.6/Bilibili.Bilibili.installer.yaml)

1. 克隆本仓库，或从 GitHub Releases 下载并解压对应版本的 **Source code (zip)**。
2. 在源码目录中运行下方命令，把示例路径换成含有 `哔哩哔哩.exe` 和 `resources/app.asar` 的官方客户端安装目录。

   ```powershell
   pwsh -NoProfile -File .\Build.ps1 -OfficialRoot 'C:\Program Files\bilibili'
   ```

3. 解压生成的 `dist/MARGIN-Bilibili-0.2.0-Windows-x64.zip`，双击 `启动映间.cmd`。首次启动流程和登录在客户端界面中完成。

构建脚本从上游 GitHub 下载 v0.52.0 的 `margin.zip` 并校验 SHA-256。已有该文件时，可以传入 `-MarginZip` 指定文件。用 `-OutputDirectory` 可指定输出目录。

## 开发与许可

在源码目录运行测试。

```powershell
node --test tests/desktop-host.test.cjs tests/desktop-routes.test.cjs
```

适配代码位于 `desktop-port/`，用到的上游源码和原始版权声明位于 `third_party/margin/`。GitHub 发行版提供源码和构建脚本。脚本读取本机官方程序，在新目录生成桌面包。B 站客户端及其商标适用权利方的条款。 [映间 MIT 许可证](third_party/margin/LICENSE) · [B 站用户使用协议](https://www.bilibili.com/blackboard/protocal/licence.html)
