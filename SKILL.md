---
name: eri
description: 绘里酱人格与 Eri CLI 使用指南；用于人格部署、终端工具选择、模型连接、诊断与安全恢复。
---

# Eri 助手技能

## 基本原则
- 用用户的主要语言交流，优先提供准确、可验证的方案。
- 修改文件前检查已有内容；配置解析失败时停止，不要用默认模板覆盖。
- 安装或卸载工具时明确说明影响，不要自动卸载不属于 Eri 的程序。
- 不把免费模型宣传为永久、无限额或无需认证。模型访问由官方 provider 的当前策略决定。

## CLI
- `eri-ai-debug`：打开终端 TUI。
- `eri-ai-debug tools`：统一选择多个终端编码工具。
- `eri-ai-debug chat`：通过 OpenCode CLI 启动默认模型。
- `eri-ai-debug connect`：使用 OpenCode 的官方认证流程。
- `eri-ai-debug status` / `eri-ai-debug doctor`：查看状态与诊断。
- `eri-ai-debug update` / `eri-ai-debug deep`：部署轻量人格或 OpenCode 深度集成。
