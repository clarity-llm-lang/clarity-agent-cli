# Changelog

## [0.3.0](https://github.com/clarity-llm-lang/clarity-agent-cli/compare/clarity-agent-cli-v0.2.0...clarity-agent-cli-v0.3.0) (2026-03-06)


### Features

* add bundled direct command install flow ([79ad10f](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/79ad10f66113296e3e0681f612848bf602180502))
* add claritycli interactive runtime chat UX ([34ce512](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/34ce5120cd43612762c33e1e7da3a03b2746ce5a))
* add claritycli interactive runtime chat UX ([0d1569c](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/0d1569cb1bc85769e904e68b7dfc352a43c09dc5))
* add native clarity serve command using http server primitives ([567172e](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/567172e5c864ef4e895dccf149ad3430a568e266))
* add runtime agent discovery and chat bridge ([73d3df9](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/73d3df9d8dd23c70e83a90569ffaa7220f166bbb))
* add single-start runtime chat agent selection flow ([e9f4256](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/e9f4256cf3df86a9fe458120d78cbc41949a07a6))
* bootstrap clarity agent cli repository ([1bad4d9](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/1bad4d9b7032ca1e589aa2a68df8d73d32f40c75))
* implement new CLI audit requirements ([#18](https://github.com/clarity-llm-lang/clarity-agent-cli/issues/18)) ([5fc5f18](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/5fc5f1889e3c900ee70b63cbe00da64987eadb47))
* migrate claritycli to native clarity module ([0310b3d](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/0310b3d0f20b5a5547da1f0eed34471b9d1f686c))
* prefer run-scoped runtime event stream ([5884315](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/5884315f2ccefb146e2d0b606ade6befdf071641))
* stream runtime chat events over SSE ([cfeff81](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/cfeff8139d1b1c49cd2611cac215810023329fb4))
* support multi-bot room and discuss mode in claritycli ([334cb31](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/334cb31484414bf73dee8f6332dab839ba4fa4fc))
* switch runtime-chat default engine to clarity ([fea1b3f](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/fea1b3fa7cd4d080d974f2fd6fb4a75983ceb2f5))
* switch to single clarity router and restore local hitl commands ([cfc9487](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/cfc9487d521cb7475a2541e446534d05969a7b3e))
* switch to single clarity router and restore local hitl commands ([f3f9990](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/f3f9990d29941821df9f920463365b7517db3050))


### Bug Fixes

* bootstrap runs using declared triggers and fail fast on zero active runs ([6ccf419](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/6ccf4194313404c77d013c81055deb5958eb9e42))
* default selection to first api-compatible agent ([da1dd80](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/da1dd80ffc7de12ac63b704fedc6c5195b818482))
* default to numeric agent selection and gate tty mode behind flag ([433c17b](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/433c17b17f1c2358f12943f6e1243647c51b0750))
* fallback to numeric selection when tty key stream is unavailable ([f58a43d](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/f58a43dd2fab9eaf4027d30fea9adc66e3ae090f))
* make plain chat input broadcast and remove target echo noise ([e098192](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/e098192fb20108e8a97dea71813aed45b1c19186))
* render step_completed chat replies in claritycli ([364e1a8](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/364e1a8d8d075e4d3ca015863bb39cfa03078ee3))
* stop idle tty menu redraw loop from exhausting wasm memory ([40ce58e](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/40ce58e6f2c630e4ff89f2cfac6662c0bf864f2e))
* surface no-response diagnostics in runtime chat loop ([86ac954](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/86ac954a4eca91ec0dfca717444cdd48a05bb4f4))
* surface no-response diagnostics in runtime chat loop ([d0b2200](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/d0b22008734e084abd2164d24366e2a8f1e3ba8a))
* update compiler lockfile to latest main with http builtins ([a056510](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/a056510463590019386456bc1ca178c3f1fc5115))

## [0.2.0](https://github.com/clarity-llm-lang/clarity-agent-cli/compare/clarity-agent-cli-v0.1.0...clarity-agent-cli-v0.2.0) (2026-02-24)

### Features

- bootstrap clarity agent cli repository ([1bad4d9](https://github.com/clarity-llm-lang/clarity-agent-cli/commit/1bad4d9b7032ca1e589aa2a68df8d73d32f40c75))
