const readline = require('readline');

// =================配置区域=================
// 请在这里填入你的大模型 API 信息 (DeepSeek, OpenAI, Kimi 等均兼容)
const API_CONFIG = {
    apiKey: "sk-qoQLpscEnIazHZa2bxfMWgkxQDIT92daHnM7XwizDlfW9oYs", // 你的 Key
    baseUrl: "http://35.220.164.252:3888/v1/chat/completions", // 接口地址
    model: "Qwen/Qwen3-8B" // 模型名称
};
// =========================================

// 全局状态
let hitCount = 0; // 挨打次数
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// ANSI 颜色代码 (让终端好看点)
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m"
};

/**
 * 1. 核心逻辑：生成 Prompt
 */
function buildPrompt(actionType, content, state) {
    let actionDesc = "";
    switch (actionType) {
        case 'speech': actionDesc = `用户对你说: "${content}"`; break;
        case 'egg': actionDesc = `用户拿鸡蛋狠狠砸在了你脸上，黏糊糊的。`; break;
        case 'paint': actionDesc = `用户往你身上泼了一桶油漆，脏死了。`; break;
        case 'flush': actionDesc = `用户按下了马桶冲水键，你正在旋转着被吸入下水道！(这是处决技)`; break;
        case 'idle': actionDesc = `用户一直盯着你，但是什么都没做，气氛突然安静。`; break;
        default: actionDesc = `用户碰了你一下。`;
    }

    const systemPrompt = `
# Role
你是一个减压游戏里的“贱萌受气包”。
你必须根据【当前动作】和【挨揍状态】做出反应。

# 状态定义
1. **healthy (健康/嚣张)**: 嘲讽用户，嘴欠，看不起用户的攻击。
2. **hurt (受伤/恼火)**: 气急败坏，抱怨疼，抱怨衣服脏了。
3. **dying (濒死/求饶)**: 彻底认怂，无底线跪舔，求爸爸放过。

# 约束
- 回复必须**极短**（15字以内）。
- 风格要**口语化**、贱兮兮。
- 只输出台词，不要输出动作描述。
`;

    return [
        { role: "system", content: systemPrompt },
        { role: "user", content: `【当前事件】: ${actionDesc}\n【当前身体状态】: ${state}` }
    ];
}

/**
 * 2. 辅助逻辑：计算当前状态
 */
function getCurrentState() {
    if (hitCount > 10) return 'dying'; // 打10下求饶
    if (hitCount > 5) return 'hurt';   // 打5下受伤
    return 'healthy';                  // 刚开始很嚣张
}

/**
 * 3. 网络请求：调用大模型
 */
async function callAI(actionType, content = "") {
    const state = getCurrentState();
    const messages = buildPrompt(actionType, content, state);

    console.log(colors.gray + `\n[...] 正在发送请求 (状态: ${state}, 动作: ${actionType})...` + colors.reset);

    try {
        const response = await fetch(API_CONFIG.baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_CONFIG.apiKey}`
            },
            body: JSON.stringify({
                model: API_CONFIG.model,
                messages: messages,
                temperature: 1.3, // 调高一点，让它更疯
                max_tokens: 50
            })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const reply = data.choices[0].message.content;

        // 打印结果
        console.log("-".repeat(30));
        console.log(`${colors.cyan}🤖 AI (${state}): ${colors.reset} ${colors.yellow}${reply}${colors.reset}`);
        console.log("-".repeat(30));

    } catch (error) {
        console.error(colors.red + "请求失败: " + error.message + colors.reset);
        console.log(colors.gray + "提示: 请检查代码顶部的 API Key 和 URL 是否正确。" + colors.reset);
    }

    showMenu();
}

/**
 * 4. 交互界面
 */
function showMenu() {
    console.log(`\n${colors.green}当前挨打次数: ${hitCount}${colors.reset}`);
    console.log("请选择操作:");
    console.log("1. 🥚 扔鸡蛋 (轻伤)");
    console.log("2. 🎨 泼油漆 (轻伤)");
    console.log("3. 🎤 骂它一句");
    console.log("4. 🚽 冲马桶 (处决)");
    console.log("5. ☕ 盯着它看 (Idle)");
    console.log("0. 退出");

    rl.question('> ', (answer) => {
        switch (answer.trim()) {
            case '1':
                hitCount++;
                callAI('egg');
                break;
            case '2':
                hitCount++;
                callAI('paint');
                break;
            case '3':
                rl.question('请输入你想骂的内容: ', (text) => {
                    // 骂人通常不扣血，或者扣很少，这里假设不扣血，纯粹看反应
                    callAI('speech', text);
                });
                break;
            case '4':
                hitCount = 999; // 直接濒死
                callAI('flush');
                break;
            case '5':
                callAI('idle');
                break;
            case '0':
                console.log("拜拜！");
                rl.close();
                process.exit(0);
                break;
            default:
                console.log("无效选项");
                showMenu();
                break;
        }
    });
}

// 启动程序
console.clear();
console.log(colors.cyan + "=== 贱萌受气包 AI 测试终端 ===" + colors.reset);
showMenu();