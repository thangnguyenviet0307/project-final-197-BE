import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const workflow = readFileSync(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const step = workflow.split("- name: Start isolated MongoDB replica set")[1].split("\n      - ")[0];
const script = step.split("        run: |\n")[1].split("\n").map(line => line.replace(/^          /, "")).join("\n");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const available = !spawnSync(bash, ["--version"]).error;
const fixture = `
exec 3>&2
docker() {
  printf 'docker:%s\\n' "$*" >&3
  case "$1" in
    run) echo fixture-container ;;
    inspect)
      if [[ "$*" == *"json .State"* ]]; then echo '{"Running":false,"ExitCode":1}'
      elif [[ "$SCENARIO" == "exited" ]]; then echo false
      else echo true; fi ;;
    exec)
      if [[ "$SCENARIO" == "ping-timeout" ]]; then return 1; fi
      if [[ "$SCENARIO" == "primary-timeout" && "$*" == *"isWritablePrimary"* ]]; then return 1; fi ;;
    logs) echo "fixture: mongod fatal startup error" ;;
  esac
}
sleep() { :; }
uname() { echo Linux-fixture; }
`;
function run(scenario) {
  return spawnSync(bash, ["-s"], { input: fixture + script, encoding: "utf8", timeout: 10000, env: { ...process.env, SCENARIO: scenario } });
}
test("CI shell is valid and boots only after a writable primary is ready", { skip: !available }, () => {
  assert.equal(spawnSync(bash, ["-n"], { input: script }).status, 0);
  const result = run("ready");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /rs.initiate/);
  assert.match(result.stderr, /isWritablePrimary/);
});
test("CI fails immediately and prints container logs if MongoDB exits", { skip: !available }, () => {
  const result = run("exited");
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /fixture: mongod fatal startup error/);
  assert.doesNotMatch(result.stderr, /docker:exec/);
});
test("CI does not initialize a replica set after a ping timeout", { skip: !available }, () => {
  const result = run("ping-timeout");
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /did not respond to ping/);
  assert.doesNotMatch(result.stderr, /rs.initiate/);
});
test("CI fails with diagnostics if replica set primary election times out", { skip: !available }, () => {
  const result = run("primary-timeout");
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /did not elect a writable primary/);
  assert.match(result.stdout, /fixture: mongod fatal startup error/);
});
