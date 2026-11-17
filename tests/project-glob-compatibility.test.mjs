import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const req = createRequire(require.resolve("typescript-eslint"));
const entry = req.resolve("@typescript-eslint/typescript-estree");
const resolverPath = path.join(path.dirname(entry), "parseSettings/resolveProjectList.js");
const resolver = require(resolverPath);

test("actual patched project resolver preserves original ordered selection corpus", t => {
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-project-glob-"));
t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const files=['tsconfig.json','a/tsconfig.json','a/sub/tsconfig.json','b/tsconfig.json','.dot/tsconfig.json','a/.hidden.json','Case/tsconfig.JSON','space dir/tsconfig.json','[literal]/tsconfig.json','(group)/tsconfig.json','{literal}/tsconfig.json','node_modules/pkg/tsconfig.json','x1.json','x2.json','a.json','b.json','foo(bar).json'];
for(const file of files){fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),'{}');}
for(const [name,target,type] of [['link','a','dir'],['linked.json','a.json','file'],['broken','missing','file'],['a/cycle','..','dir']])try{fs.symlinkSync(process.platform === 'win32' ? path.resolve(dir, path.dirname(name), target) : target,path.join(dir,name),type==='dir'&&process.platform==='win32'?'junction':type);}catch(e){if(e.code!=='EEXIST')throw e;}
const cases=[
 ['literal',['missing.json','a/tsconfig.json','a']], ['all',['**/*.json']],['overlap',['b/tsconfig.json','**/tsconfig.json','a/*.json']],
 ['dot',['.dot/*.json','a/.*.json']],['braces',['{a,b}/tsconfig.json']],['range',['x{1..2}.json']],['class',['[ab].json']],['extglob',['@(a|b).json']],['paren',['foo(bar).json']],['escaped',['\\[literal\\]/*.json']],['unfinished',['foo(.json','{a,b.json']],['negative',['!a/*.json','!!a/*.json']],['negext',['!(a).json']],['absolute',[`${dir.split(path.sep).join("/")}/a/*.json`]],['parent',[`../${path.basename(dir)}/b/*.json`]],['empty',['',null,12]],['missingglob',['absent/*.json']],['ignore-dir',['**/*.json'],['a']],['ignore-subtree',['**/*.json'],['a/**']],['ignore-negation',['**/*.json'],['a/**','!a/tsconfig.json']],['ignore-dot',['.dot/*.json'],['**/*.json']],['ignore-absolute',['a/*.json'],[`${dir.split(path.sep).join("/")}/a/**`]],['ignore-extglob',['*.json'],['@(a|b).json']],['backslash',['a\\*.json']],['links',['link/**/*.json','linked*.json','broken*']]
];
const baseline = JSON.parse(fs.readFileSync(new URL("./fixtures/project-glob-baseline.json", import.meta.url)));
for (const [name, project, ignore] of cases) {
    resolver.clearGlobResolutionCache();
    if (["paren", "unfinished", "negext"].includes(name)) {
        assert.throws(() => resolver.resolveProjectList({ project, projectFolderIgnoreList: ignore, tsconfigRootDir: dir, singleRun: true }), /Unsupported legacy project glob/u, name);
        continue;
    }
    const actual = [...resolver.resolveProjectList({ project, projectFolderIgnoreList: ignore, tsconfigRootDir: dir, singleRun: true })].map(([k,v]) => [path.relative(dir,k).replaceAll("\\", "/"), path.relative(dir,v).replaceAll("\\", "/")]);
    assert.deepEqual(actual, baseline[name], name);
}
});

test("glob executes the real audited matcher dependency, with the old graph removed", () => {
    const estree = createRequire(entry);
    const glob = createRequire(estree.resolve("glob/raw"));
    assert.equal(glob("glob/package.json").version, "14.0.6");
    assert.equal(glob("minimatch/package.json").version, "11.0.9");
    assert.equal(estree("minimatch/package.json").version, "11.0.4");
    assert.match(estree.resolve("glob/raw"), /index\.js$/u);
    const lock = fs.readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
    for (const name of ["picomatch", "tinyglobby", "fdir"]) {
        assert.doesNotMatch(lock, new RegExp(`^  ['"]?${name}[@:]`, "mu"));
        assert.throws(() => estree.resolve(name), { code: "MODULE_NOT_FOUND" });
    }
});

test("repeated extglob project patterns finish in an isolated bounded process", () => {
    const script = `const r = require(${JSON.stringify(resolverPath)}); r.resolveProjectList({ project: ["+(a)".repeat(100) + "b.json"], tsconfigRootDir: process.cwd(), singleRun: true });`;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
});

test("overlapping tsconfigs preserve the first selected TypeScript program", t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-project-priority-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [name, strict] of [["first", true], ["second", false]]) {
        fs.mkdirSync(path.join(dir, name));
        fs.writeFileSync(path.join(dir, name, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict }, include: ["../shared.ts"] }));
    }
    fs.writeFileSync(path.join(dir, "shared.ts"), "export const value = 1;");
    const estree = req("@typescript-eslint/typescript-estree");
    const result = estree.parseAndGenerateServices("export const value = 1;", {
        filePath: path.join(dir, "shared.ts"), tsconfigRootDir: dir,
        project: ["second/*.json", "first/*.json"],
    });
    assert.equal(result.services.program.getCompilerOptions().strict, false);
});

test("incompatible legacy grammar fails explicitly, including ignored patterns", () => {
    for (const pattern of ["a(b|c).json", "!(ab).json", "a{01..05..2}.json"]) {
        for (const asIgnore of [false, true]) {
            resolver.clearGlobResolutionCache();
            assert.throws(() => resolver.resolveProjectList({
                project: asIgnore ? ["*.json"] : [pattern],
                projectFolderIgnoreList: asIgnore ? [pattern] : [],
                tsconfigRootDir: process.cwd(), singleRun: true,
            }), /Unsupported legacy project glob/u);
        }
    }
});
