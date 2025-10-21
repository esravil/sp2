# Simple Swap Program

# Overview:

1. 3 HANDLERS -> Make Offer, Take Offer, Refund Offer
2. Offer Struct
3. Accounts: ATAs, Offer PDAs, PDA-specific owned vault


# Set up steps

1. anchor init <name> --template=multiple
2. create your rust program
3. anchor build + anchor keys sync
4. rm -rf empty app dir in anchor repo root 
5. npx create-solana-dapp@latest <name>
6. Remove tsconfig.json in the anchor repo root, using TSX only
7. Update auto-generated package.json (remove all deps + devdeps) + add "type": "module" at bottom
8. at anchor repo root new deps for ts client interactions: npm i @solana/kit solana-kite (kite takes care of boilerplate code)
9. at anchor repo root for dev deps: npm i -D codama @codama/renderers @codama/nodes-from-anchor typescript tsx @types/node prettier
10. Instead of creating a custom file for creating codama client at anchor repo root, use bash cmd in anchor repo root: npx codama init (target/idl/<name>.json -> js client -> app/src/clients/generated)
11. Update package.json in the anchor repo root w/ some scripts: 
    "client:gen": "codama run js --config ./codama.json",
    "build:all": "anchor build && npm run client:gen",
    "rebuild:client": "anchor build && npm run client:gen",
    "typecheck": "tsc -p app/tsconfig.json --noEmit"
12. In anchor repo root, run: npm run client:gen
13. In tests/<name>.ts, use generated files to write out test (can use gpt here safely, just ensure you provide kite types)
14. Update anchor.toml in the anchor repo root and change test script to the following (if using tsx for testing): test = "npx tsx --test --test-reporter=spec tests/**/*.ts"
15. After test file is valid -> work on frontend
16. 



***OPTIONAL: keep idl and idl types in app/src/idl/ for idl legacy***