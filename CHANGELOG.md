## [2.0.1](https://github.com/SourceRegistry/node-prometheus/compare/v2.0.0...v2.0.1) (2026-04-26)


### Bug Fixes

* building and publishing of documentation ([bceeb52](https://github.com/SourceRegistry/node-prometheus/commit/bceeb522eef81ed9ee1985b772776053b22df34d))

# [2.0.0](https://github.com/SourceRegistry/node-prometheus/compare/v1.0.2...v2.0.0) (2026-04-26)


* feat!: replace callback summaries with streaming quantiles ([8eade9c](https://github.com/SourceRegistry/node-prometheus/commit/8eade9c6625c83c87ce2b598bed9dd6eee7a42fb))


### BREAKING CHANGES

* Summary no longer accepts a calculate callback. Configure quantiles with numeric targets or { quantile, error } entries instead.

## [1.0.2](https://github.com/SourceRegistry/node-prometheus/compare/v1.0.1...v1.0.2) (2025-09-09)


### Bug Fixes

* README.md ([a348bff](https://github.com/SourceRegistry/node-prometheus/commit/a348bff0037ec50a8edfe82e764ccd5d851e44a6))

## [1.0.1](https://github.com/SourceRegistry/node-prometheus/compare/v1.0.0...v1.0.1) (2025-09-09)


### Bug Fixes

* concat method in README to now include format identifier ([dc040b0](https://github.com/SourceRegistry/node-prometheus/commit/dc040b0de3be422cb0f95b8d428f0343fb02fed2))

# 1.0.0 (2025-09-09)


### Bug Fixes

* test output to also test for openmetrics compatible output ([8e12f16](https://github.com/SourceRegistry/node-prometheus/commit/8e12f1637a584a9239238ed87562c58a91fb0486))


### Features

* added open metrics concat option ([09156fa](https://github.com/SourceRegistry/node-prometheus/commit/09156fa5579dcba63fc403534c47f8fd072eb320))
