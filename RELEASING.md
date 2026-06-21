# Releasing Midnight Auction

This repo publishes releases automatically when a version tag is pushed.

## Release a new version

1. Update `version` in `module.json`, such as `1.0.3`.
2. Commit the change.
3. Tag the commit with the matching version:

   ```bash
   git tag v1.0.3
   git push
   git push origin v1.0.3
   ```

GitHub Actions will create a GitHub Release with:

- `midnight-auction.zip`
- `module.json`

Foundry can use this manifest URL:

```text
https://github.com/edgedoggo/midnight-auction/releases/latest/download/module.json
```
