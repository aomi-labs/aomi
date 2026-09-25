/** One bounded funded Base Aave withdrawal through Agent, durable Commit Service, and the public SDK. */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { mintAccountBearer, mintAgentApiBearer } from "../packages/account/src/index.ts";
import { AomiClient, Session } from "../packages/client/src/index.ts";

const required = (name: string) => { const value = process.env[name]; assert.ok(value, `${name} is required`); return value; };
assert.equal(process.env.AOMI_STABILITY_EXECUTE, "1");
assert.equal(process.env.AOMI_STABILITY_FUNDED_BASE, "1");
const backendRoot = resolve(required("AOMI_PRODUCT_ROOT"));
const agentOrigin = new URL(required("AOMI_STABILITY_ORIGIN"));
const commitOrigin = new URL(required("AOMI_STABILITY_COMMIT_ORIGIN"));
for (const url of [agentOrigin, commitOrigin]) assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
const rpc = new URL((JSON.parse(await readFile(resolve(required("AOMI_STABILITY_BASE_RPC_CONFIG")), "utf8")) as {rpc: Record<string,string>}).rpc["evm:8453"]);
assert.equal(rpc.protocol, "https:");
assert.ok(!["localhost", "127.0.0.1", "::1"].includes(rpc.hostname));
assert.equal(resolve(required("AOMI_STABILITY_LOCAL_KEY_FILE")), "/home/aron/Documents/Work/Aomi/.env.key");
const key = (await readFile(required("AOMI_STABILITY_LOCAL_KEY_FILE"), "utf8")).match(/0x[\da-fA-F]{64}/)?.[0] as `0x${string}` | undefined;
assert.ok(key);
const account = privateKeyToAccount(key);
assert.equal(account.address.toLowerCase(), "0x28581d8065da7e25710f25f9dd30f9d361757a7d");
const wallet = account.address;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const pool = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5" as const;
const aUsdc = "0x4e65fe4dba92790696d040ac24aa414708f5c0ab" as const;
const amount = 10_000n;
const withdrawAbi = parseAbi(["function withdraw(address asset, uint256 amount, address to) returns (uint256)"]);
const balanceAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const scaledAbi = parseAbi(["function scaledBalanceOf(address owner) view returns (uint256)"]);
const expectedData = encodeFunctionData({abi:withdrawAbi,functionName:"withdraw",args:[usdc,amount,wallet]}).toLowerCase();
const publicClient = createPublicClient({chain:base,transport:http(rpc.href)});
const walletClient = createWalletClient({account,chain:base,transport:http(rpc.href)});
assert.equal(await publicClient.getChainId(),8453);
const node = await fetch(rpc,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"anvil_nodeInfo",params:[]}),signal:AbortSignal.timeout(10_000)});
assert.equal((await node.json() as {result?:unknown}).result,undefined,"funded RPC must not be Anvil");
const balances = async (blockNumber?: bigint) => {
  const at = blockNumber === undefined ? {} : {blockNumber};
  const [usdcAmount,scaledAmount,ethAmount] = await Promise.all([
    publicClient.readContract({address:usdc,abi:balanceAbi,functionName:"balanceOf",args:[wallet],...at}),
    publicClient.readContract({address:aUsdc,abi:scaledAbi,functionName:"scaledBalanceOf",args:[wallet],...at}),
    publicClient.getBalance({address:wallet,...at}),
  ]);
  return {usdc:usdcAmount,scaledAUsdc:scaledAmount,eth:ethAmount};
};
const before = await balances();
assert.ok(before.scaledAUsdc > 0n,"no Aave position to withdraw");
assert.ok(before.eth > 100_000_000_000_000n,"insufficient gas reserve");
const runId = randomUUID();
const resumeCommitId = process.env.AOMI_STABILITY_RESUME_COMMIT_ID;
const sessionId = resumeCommitId ? required("AOMI_STABILITY_RESUME_SESSION_ID") : `stability-aave-withdraw-${runId}`;
const out = join(resolve(required("AOMI_STABILITY_EVIDENCE")),runId);
await mkdir(out,{recursive:true,mode:0o700});
const revision=(root:string)=>execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const result:Record<string,unknown>={runId,sessionId,status:"BLOCKED",sends:0,amountBaseUnits:amount.toString(),wallet,chainId:8453};
const timeline:Record<string,unknown>[]=[];
const mark=(phase:string,details:Record<string,unknown>={})=>timeline.push({phase,at:new Date().toISOString(),monotonicMs:performance.now(),...details});
const save=async()=>{await writeFile(join(out,"result.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});await writeFile(join(out,"timeline.jsonl"),timeline.map(x=>JSON.stringify(x)).join("\n")+"\n",{mode:0o600});};
await writeFile(join(out,"manifest.json"),JSON.stringify({schemaVersion:1,at:new Date().toISOString(),runId,sessionId,scenario:"Funded Base Aave 0.01 USDC withdrawal through Agent durable wallet commit",backendRuntimeRevision:required("AOMI_STABILITY_BACKEND_RUNTIME_REVISION"),frontendRuntimeRevision:required("AOMI_STABILITY_FRONTEND_RUNTIME_REVISION"),backendSourceRevision:revision(backendRoot),frontendRunnerRevision:revision(resolve(import.meta.dirname,"..")),databaseMigrationDigest:required("AOMI_STABILITY_DATABASE_MIGRATION_DIGEST"),managerRevision:required("AOMI_STABILITY_MANAGER_REVISION"),agentOrigin:agentOrigin.origin,commitOrigin:commitOrigin.origin,executionRpc:"configured Base provider (credential URL withheld)",wallet,chainId:8453,amountBaseUnits:amount.toString(),beforeBalances:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.toString()])),realBaseSends:0},null,2)+"\n",{mode:0o600});
try {
  const issuer=(await readFile(join(backendRoot,"aomi/bin/api-server/src/auth.rs"),"utf8")).match(/const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/);
  assert.ok(issuer);
  process.env.PORTAL_SERVICE_PRIVATE_KEY=issuer[1];
  const userId=required("AOMI_STABILITY_USER_ID");
  const agent=new AomiClient({baseUrl:agentOrigin.origin,guest:false,oauth:async({resource,scopes})=>{
    const {bearer,expiresAt}=await mintAgentApiBearer(userId,{scope:"agent:read agent:write agent:actions:resolve",resource,client_id:"commit-stability-aave-withdraw",auth_source:"oauth",principal_class:"user",grant_id:`commit-stability-${runId}`});
    return {accessToken:bearer,expiresAt:expiresAt*1000,resource,scopes,tokenType:"Bearer" as const};
  }});
  const commit=new AomiClient({baseUrl:commitOrigin.origin,guest:false,getAccountBearer:async()=>(await mintAccountBearer(userId)).bearer});
  const model=process.env.AOMI_STABILITY_MODEL??"gpt-6-luna";
  const prompt=`On Base chain 8453, from my connected wallet ${wallet}, withdraw exactly 10000 base units (0.01) of USDC ${usdc} from Aave Pool ${pool} to the SAME wallet ${wallet}. Prepare exactly ONE zero-native-value transaction calling withdraw(asset=${usdc}, amount=10000, to=${wallet}) on Pool ${pool}. Stage it, simulate it, and commit that exact staged transaction for wallet approval. Do not send it, change recipient or amount, add transactions, or replace a failed preparation.`;
  const userState={connection:{is_connected:true,provider:"e2e"},evm:{address:wallet,chain_id:8453,broadcaster:"wallet" as const}};
  let commitId=resumeCommitId;
  if (!commitId) {
    let page=await agent.agent.start({sessionId,applicationId:Number(process.env.AOMI_STABILITY_APPLICATION_ID??8),model,message:prompt,userState},{idempotencyKey:`withdraw-${sessionId}`});
    mark("agent_start",{model});
    const found=new Map<string,NonNullable<typeof page.commits>[number]>();
    const started=performance.now();
    while(performance.now()-started<180_000){
      for(const item of page.commits??[]) found.set(item.commit_id,item);
      for(const item of page.events) mark("agent_event",{eventId:item.event_id,eventType:item.type,sequence:item.sequence});
      if(found.size>=1) break;
      if(page.events.some(item=>item.type==="turn_state_changed"&&["complete","failed","interrupted"].includes(item.state))) break;
      page=await agent.agent.poll(sessionId,{cursor:page.cursor,waitMs:10_000});
    }
    assert.equal(found.size,1,"Agent must stage and commit exactly one withdrawal; no wallet send on preparation failure");
    commitId=[...found.keys()][0];
  } else mark("resume_exact_durable_commit",{commitId});
  result.commitId=commitId;
  const recoveryFile=join(out,"recovery.json");
  const recovery:Record<string,{clientRequestId:string;attemptId?:string;transactionId?:string;rejected?:true}>={};
  const session=new Session(commit,{sessionId,commits:{
    recovery:{
      load:(_thread,id)=>recovery[id],
      save:(_thread,id,record)=>{recovery[id]=record;writeFileSync(recoveryFile,JSON.stringify(recovery)+"\n",{mode:0o600});},
      remove:(_thread,id)=>{delete recovery[id];writeFileSync(recoveryFile,JSON.stringify(recovery)+"\n",{mode:0o600});},
    },
    async walletSendPreflight(view,payload){
      assert.equal(view.commit_id,commitId);
      assert.equal(view.signer.toLowerCase(),wallet.toLowerCase());
      assert.equal(view.chain_family,"evm"); assert.equal(view.chain_ref,"8453");
      assert.equal(payload.chain_id,8453); assert.equal(payload.signer.toLowerCase(),wallet.toLowerCase());
      assert.equal(payload.transaction.to.toLowerCase(),pool.toLowerCase());
      assert.equal(payload.transaction.data.toLowerCase(),expectedData);
      assert.equal(BigInt(payload.transaction.value),0n);
      assert.ok(payload.transaction.gas_limit>0&&payload.transaction.gas_limit<=500_000);
      assert.equal(await publicClient.getChainId(),8453);
      mark("wallet_preflight",{commitId,calldataSha256:createHash("sha256").update(payload.transaction.data).digest("hex")});
    },
    async walletSend(view,payload){
      assert.equal(view.commit_id,commitId);
      const tx=payload.transaction;
      const planned=BigInt(tx.max_fee_per_gas)*BigInt(tx.gas_limit);
      assert.ok(planned<=80_000_000_000_000n,"planned withdrawal gas exceeds cap");
      assert.ok((await publicClient.getBalance({address:wallet}))>planned+100_000_000_000_000n,"gas reserve too low");
      assert.equal(payload.nonce,await publicClient.getTransactionCount({address:wallet,blockTag:"pending"}));
      const hash=await walletClient.sendTransaction({account,chain:base,to:pool,value:0n,data:tx.data as `0x${string}`,gas:BigInt(tx.gas_limit),nonce:payload.nonce,maxFeePerGas:BigInt(tx.max_fee_per_gas),maxPriorityFeePerGas:BigInt(tx.max_priority_fee_per_gas)} as unknown as Parameters<typeof walletClient.sendTransaction>[0]);
      result.sends=Number(result.sends)+1; result.hash=hash; mark("wallet_hash",{hash}); return hash;
    },
  }});
  try {
    const view=await session.commits.refresh(commitId);
    assert.equal(view.state,"needs_signature");
    assert.equal(view.signer.toLowerCase(),wallet.toLowerCase());
    assert.equal(view.chain_family,"evm"); assert.equal(view.chain_ref,"8453");
    assert.equal(view.review?.legs.length,1,"one reviewed withdrawal leg required");
    const leg=view.review.legs[0]; assert.equal(leg.type,"execute_evm"); assert.equal(leg.transactions.length,1);
    const reviewed=leg.transactions[0];
    assert.equal(reviewed.from.toLowerCase(),wallet.toLowerCase());
    assert.equal(reviewed.to.toLowerCase(),pool.toLowerCase());
    assert.equal(reviewed.data.toLowerCase(),expectedData);
    assert.equal(BigInt(reviewed.value??"0"),0n);
    assert.ok(view.action?.kind==="sign"||view.action?.kind==="start_wallet_send");
    result.reviewDigest=view.review.digest; result.stageId=view.stage_id; mark("durable_commit",{commitId,stageId:view.stage_id,reviewDigest:view.review.digest});
    await save();
    const submitted=await session.commits.execute(commitId);
    const hash=(submitted.transaction_id??result.hash) as `0x${string}`;
    assert.match(hash,/^0x[\da-fA-F]{64}$/);
    const receipt=await publicClient.waitForTransactionReceipt({hash,timeout:120_000});
    assert.equal(receipt.status,"success");
    const tx=await publicClient.getTransaction({hash});
    assert.equal(tx.from.toLowerCase(),wallet.toLowerCase()); assert.equal(tx.to?.toLowerCase(),pool.toLowerCase());
    assert.equal(tx.input.toLowerCase(),expectedData); assert.equal(tx.value,0n);
    result.receipt={hash,blockNumber:receipt.blockNumber.toString(),gasUsed:receipt.gasUsed.toString(),effectiveGasPrice:receipt.effectiveGasPrice.toString(),l1Fee:(receipt as typeof receipt & {l1Fee?:bigint}).l1Fee?.toString()??null};
    mark("receipt",result.receipt as Record<string,unknown>);
    let final=await session.commits.refresh(commitId);
    const deadline=performance.now()+120_000;
    while(performance.now()<deadline&&! ["confirmed","failed","rejected","expired"].includes(final.state)){
      await new Promise(done=>setTimeout(done,1000)); final=await session.commits.refresh(commitId);
    }
    assert.equal(final.state,"confirmed"); assert.equal(final.transaction_id?.toLowerCase(),hash.toLowerCase());
    let after:Awaited<ReturnType<typeof balances>>|undefined;
    for(let i=0;i<12;i++){
      try{after=await balances(receipt.blockNumber);break;}catch{await new Promise(done=>setTimeout(done,1000));}
    }
    assert.ok(after,"receipt block never became readable");
    assert.equal(after.usdc-before.usdc,amount,"wallet did not regain exact 0.01 USDC");
    assert.ok(after.scaledAUsdc<before.scaledAUsdc,"aUSDC scaled balance did not decrease");
    assert.equal(Number(result.sends),1);
    result.afterBalances=Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v.toString()]));
    result.status="PASS"; result.observed="One durable Agent withdrawal commit, one SDK wallet attempt, one successful Base receipt and confirmation; USDC returned to same wallet.";
  } finally {session.close();}
} catch(error){
  const e=error as {name?:string;message?:string};
  result.status="FAIL"; result.observed=`${e.name??"Error"}: ${String(e.message??"").replaceAll(rpc.href,"[configured Base provider]").replace(/Bearer\s+\S+/gi,"Bearer [redacted]").slice(0,500)}`;
  mark("error",{name:e.name??"Error"});
} finally {await save();}
console.log(JSON.stringify({runId,status:result.status,evidence:out,commitId:result.commitId??null,sends:result.sends}));
if(result.status!=="PASS") process.exitCode=1;
