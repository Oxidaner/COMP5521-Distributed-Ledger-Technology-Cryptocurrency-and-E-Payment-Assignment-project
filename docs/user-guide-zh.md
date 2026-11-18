# COMP5521 项目操作说明

本说明按当前网页的英文按钮编写。你可以一个人用同一个页面，在 MetaMask 中切换 Alice、Bob 两个账户完成演练。页面有两个操作区：`Live exchange desk` 用于普通兑换，`Private point-lock exchange` 用于隐私 Challenge，两者分别生成自己的计划、操作自己的合约。

## 1. 启动与准备

在终端执行：

```bash
cd /Users/oxidaner/polyu/project/5521

# 第一次运行，或依赖变化后执行
npm ci

# 启动网页，操作期间保持终端运行
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

使用安装了 MetaMask 的 Chrome 打开 <http://127.0.0.1:5173>。若终端提示端口占用，先检查已有服务，不要同时启动多个实例。

当前仓库已经配置好测试网合约。直接操作现有部署时，不需要重新部署，也不需要把私钥填入网页。浏览器交易由 MetaMask 签名，`.env` 仅供终端脚本使用。

准备两个不同的 MetaMask 账户，并记下完整地址：

| 角色 | 需要的资产 | 用途 |
| --- | --- | --- |
| Alice | Ethereum Sepolia 上至少 1 MST，以及两条链上的测试 ETH | 锁定 MST，在 Arbitrum 领取 ETH，支付交易 Gas |
| Bob | Arbitrum Sepolia 上至少 0.0001 ETH，另留 Gas，以及 Ethereum Sepolia 上的测试 ETH | 锁定 ETH，在 Ethereum 领取 MST，支付交易 Gas |

两条网络分别是 Ethereum Sepolia，Chain ID `11155111`，以及 Arbitrum Sepolia，Chain ID `421614`。每个账户在两条网络上的 ETH 余额分别计算。

在 MetaMask 中选中 Alice，再点击网页右上角的 `Connect wallet`，在 MetaMask 中授权当前站点。后续切换账户时，确认页面显示的地址和角色一起变化。如果未变化，重新点击右上角的钱包按钮连接当前账户。点击交易按钮时，网页会请求切换到对应网络；缺少网络时，会请求添加网络。

## 2. 普通成功兑换

使用 `Live exchange desk`。第一次演练先保留默认期限，ETH 10 分钟、MST 20 分钟，熟悉后再使用短期限。期限从生成计划时开始计算。

1. **Alice 生成计划。** 填入 `Alice address`、`Bob address`，金额填 `MST amount = 1`、`ETH amount = 0.0001`，先不勾选 `Demo deadlines`，点击 `Generate plan and secret`。核对右侧显示的双方地址、金额和到期时间。
2. **保存 Alice 的秘密。** 展开 `Private secret / recovery backup`，点击 `Download private backup`。将文件保存在本地。刷新页面会清除未保存的计划和秘密。
3. **Alice 锁定 MST。** 确认 `Current role` 为 `Alice`，点击 `Alice: approve and lock MST`。MetaMask 会切换到 Ethereum Sepolia。授权不足时，先确认 MST 授权，再确认锁定交易，可能出现两次交易确认。等待网页提示完成，Ethereum 状态变为 `Active`。
4. **Bob 验证并锁定 ETH。** 在 MetaMask 切换到 Bob，确认页面角色变为 `Bob`。点击 `Independently verify MST`，验证成功后点击 `Bob: create matching ETH lock`。确认 Arbitrum Sepolia 上的交易，等待两条链都显示 `Active`。
5. **Alice 领取 ETH。** 切回 Alice，点击 `Alice: verify and claim ETH`，在 MetaMask 确认交易。完成后，Arbitrum 状态变为 `Claimed`。页面会自动填入 `ETH claim transaction hash`。
6. **Bob 领取 MST。** 切回 Bob，保留上一步的交易哈希，点击 `Bob: observe secret and claim MST`。网页从 Alice 已确认的领取交易中提取秘密，随后请求 Ethereum Sepolia 上的领取交易。
7. **检查结果。** 点击 `Refresh chains`，确认 Ethereum 和 Arbitrum 都是 `Claimed`。下方交易记录可打开区块浏览器查看每笔交易。

同一个页面内切换账户会保留当前计划，通常不需要导入 JSON。两边锁定完成后，再下载一次最新私密备份，并保存包含双方锁定交易哈希的最新公共计划，方便恢复。

## 3. 超时退款

使用一份新的普通兑换计划。先保存上一笔交换的最新备份和公共计划，再生成新计划，避免丢失尚未完成的交换资料。

1. 勾选 `Demo deadlines: ETH 90s / MST 180s`，点击 `Generate plan and secret`，保存私密备份。这两个期限仍从生成计划时开始计算。
2. 按普通兑换的步骤，让 Alice 锁定 MST，再让 Bob 验证并锁定 ETH。两边都显示 `Active` 后，保持不领取。
3. 在到期前展示下方的 `Sender: refund after expiry` 按钮不可用，说明尚不能退款。
4. ETH 到期后，切到 Bob，点击 `Refresh chains`。Arbitrum 状态变为 `Expired` 后，点击 **Arbitrum 那一栏**的 `Sender: refund after expiry`，确认交易。
5. MST 到期后，切到 Alice，刷新状态，点击 **Ethereum 那一栏**的同名退款按钮，确认交易。
6. 最终两条链都应显示 `Refunded`。

到期依据是各自链上的区块时间。如果本地时间到了但仍显示 `Active`，刷新后查看页面展示的区块时间。如果 Bob 没有完成 ETH 锁定，Arbitrum 会是 `Missing`，只需要 Alice 在 MST 到期后退款。如果一边已经领取，应继续检查另一边的领取路径，不能把它当作“两边都未领取”的退款演练。

## 4. 隐私 Challenge 成功兑换

滚动到 `Private point-lock exchange`。这一部分使用新的隐私计划，普通兑换的计划和秘密不能直接用于这里。网页默认仍是 ETH 10 分钟、MST 20 分钟，当前隐私界面没有短期限复选框。

1. **Bob 准备偏移值。** 切到 Bob，点击 `Generate Bob offset`，再点击 `Save Bob offset backup`。页面的 `Bob private offset` 是 Bob 的私密值，`Bob offset point (share directly with Alice)` 是给 Alice 的点数据。
2. **Alice 生成计划与证明。** 在同一页面演练时，保留已有的点数据即可。切到 Alice，填写 `Private Alice address`、`Private Bob address`，金额使用 `1` MST 和 `0.0001` ETH，点击 `Generate private plan and proof`。
3. **保存参与者备份。** 展开 `Participant backup`，点击 `Save private participant backup`。一个人共用页面演练时，备份可能同时包含 Alice 和 Bob 的秘密，应保存在本地。
4. **Alice 锁定 MST。** 点击 `Alice: approve and lock private MST`，按 MetaMask 提示完成授权和锁定。等待 Ethereum 状态变为 `Active`。
5. **Bob 验证证明。** 切到 Bob，点击 `Bob: verify proof, offset and MST lock`。它会核对证明、Bob 的私密值及实际 MST 锁定信息。验证通过后，点击 `Bob: lock private ETH` 并确认交易。
6. **Alice 领取 ETH。** 等两条链都是 `Active`，切到 Alice，点击 `Alice: claim private ETH`。完成后，页面自动填入 `First private ETH claim transaction`。
7. **Bob 推导并领取 MST。** 切到 Bob，点击 `Bob: derive value and claim private MST`。网页读取 Alice 已确认的领取交易，结合 Bob 的私密值推导另一领取值，然后发起 MST 领取。
8. **检查两条链。** 点击 `Refresh private chains`，确认都显示 `Claimed`。两条链的 Swap ID、锁定点及公开领取值不同。

隐私退款的操作顺序与普通退款相同：保持不领取，ETH 到期后由 Bob 退回 ETH，MST 到期后由 Alice 退回 MST。使用隐私区各链下面的 `Sender: refund private lock after expiry`。网页默认需等待约 10 分钟和 20 分钟；终端的隐私退款演练使用 60 秒和 120 秒。

新建下一笔隐私兑换前，保存当前参与者备份，再点击 `Start new private session`，重新生成 Bob 的偏移值。每笔交换都要使用新的偏移值。`Peer handoff (never publish)` 中的 JSON 只交给交易对手，不应贴到公开仓库或公开演示材料中；其中的证明和关联点会暴露两笔锁定的对应关系。地址、金额和时间本身仍可能让观察者关联交易。

## 5. 两人分开操作时如何交接

两个人使用各自的浏览器和钱包时，账户切换改为由对应参与者在自己的页面操作。

| 场景 | 交接方式 |
| --- | --- |
| 普通兑换，Alice 锁好 MST | Alice 展开 `Public plan (share after MST lock)`，复制完整 JSON 给 Bob。Bob 粘贴到 `Import public plan or private recovery file`，点击 `Import plan`，再验证 MST |
| 普通兑换，Bob 锁好 ETH | Bob 将更新后的公共计划发回 Alice。Alice 在原页面导入，匹配的秘密会保留；页面已关闭时，先导入自己的私密备份，再导入更新后的公共计划 |
| 普通兑换，Alice 已领取 ETH | Alice 将确认后的领取交易哈希发给 Bob，Bob 填入 `ETH claim transaction hash` 再领取 MST |
| 隐私兑换，Bob 生成偏移值 | Bob 只将 `Bob offset point` 中的点数据交给 Alice，保留自己的 offset 备份。Alice 粘贴到自己的同名输入框后生成计划 |
| 隐私兑换，Alice 锁好 MST | Alice 将 `Peer handoff (never publish)` 的完整 JSON 私下发给 Bob。Bob 在生成偏移值的原页面导入；若已关闭页面，先导入自己的 offset 备份，再导入 Alice 的计划 |
| 隐私兑换，Bob 锁好 ETH | Bob 私下将更新后的 peer plan 发回 Alice。Alice 在原页面导入；若已关闭页面，先导入自己的参与者备份，再导入更新后的计划 |
| 隐私兑换，Alice 已领取 ETH | Alice 将领取交易哈希发给 Bob，Bob 填入 `First private ETH claim transaction` 后推导并领取 MST |

隐私区的计划和备份统一粘贴到 `Import peer plan or private backup`，点击 `Import private material`。双方各自保存参与者备份，Alice 的私密领取值和 Bob 的私密偏移值不互相发送。

## 6. 状态和异常处理

| 页面显示 | 含义与下一步 |
| --- | --- |
| `Missing` | 该链尚未锁定资产，按当前角色执行锁定步骤 |
| `Active` | 资产已锁定且尚未到期，可以按流程领取 |
| `Expired` | 未完成且已到期，由该链的原发送者退款 |
| `Claimed` | 该链领取已完成；成功兑换最终两边都应是这个状态 |
| `Refunded` | 该链退款已完成；双边退款演练最终两边都应是这个状态 |
| `Unavailable` | 该链 RPC 暂时读不到状态，点击对应刷新按钮。另一条链状态正常时，可继续操作其可用退款入口 |
| `Waiting for wallet signature` | 打开 MetaMask，检查并确认当前请求 |
| `Broadcast; waiting for confirmation` | 交易已经发出，等待确认，可点击交易链接查看 |
| `Confirmation failed or unavailable` | 先打开保留的交易链接核对结果，再刷新链上状态，避免直接重复发交易 |

如果某个按钮是灰色，依次检查当前角色、两条链的状态、验证步骤是否完成，以及到期时间。生成后尚未锁定的计划一旦过期，需要重新生成；已有锁定应按原计划继续领取或到期退款。

刷新或重开页面后，把自己保存的私密备份内容粘贴到对应导入框。备份里的锁定哈希较旧时，再导入最新公共计划或 peer plan。如果 Alice 的领取交易哈希丢失，可以从她的 MetaMask 交易记录或区块浏览器找回并填入。

## 7. 四分钟现场演示与终端辅助

首次练习先完整跑通普通成功兑换和普通退款，记录真实耗时。课堂的四分钟操作可以用网页完成成功兑换，同时在第二个终端运行新的退款实例，让等待时间重叠。

以下终端命令需要事先配置好本地 `.env` 的 RPC、Alice/Bob 地址及测试账户私钥。它们会发送真实测试网交易：

```bash
cd /Users/oxidaner/polyu/project/5521

# 普通退款演练：ETH 45 秒，MST 90 秒
npm run protocol -- recovery

# 隐私成功兑换
npm run protocol:private -- success

# 隐私退款演练：ETH 60 秒，MST 120 秒
npm run protocol:private -- recovery
```

普通退款命令会展示提前退款被拒绝的只读调用，再等待各链到期并发送退款交易。终端会打印交易哈希和最终状态。要在网页检查这次普通退款，将该次生成的 `docs/evidence/testnet-recovery.json` 中的 **`plan` 对象**导入普通兑换区；不要把整个证据文件当作计划导入。

普通成功兑换在网页进行时，使用默认期限。退款实例在演示开始时并行启动，不要等成功兑换结束后才开始 180 秒的网页退款计划。具体时间安排见 [现场演示流程](demo.md)。

演示前可执行以下检查。两条 `--live` 命令只读查询测试网，不会重新发送兑换交易：

```bash
npm test
npm run build:web
npm run check:acceptance -- --live
npm run check:privacy -- --live
```

功能演练完成后，还需填写 `docs/contributions.md` 中真实姓名、学号和个人工作证据，并完成本人讲解与 Q&A。历史交易证据不能代替现场实时操作。
