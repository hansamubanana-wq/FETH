// 「賭け方のコツ」画面の本文を組み立てる。賭け式・特殊能力・脚質はデータから
// 動的生成するので、ゲーム本体と常に一致する。
export function buildGuideHTML(betTypes, abilities, styles, placeN) {
    const sec = (title, body) => `<div class="guide-sec"><h3>${title}</h3>${body}</div>`;

    // 賭けの種類
    const betRows = betTypes.map((t) =>
        `<li><b>${t.label}</b>（${t.nPick}頭${t.ordered ? "・着順通り" : t.nPick > 1 ? "・順不同" : ""}）— ${t.desc}</li>`
    ).join("");

    // 脚質
    const styleRows = Object.values(styles).map((s) =>
        `<li><b>${s.label}</b> — ${s.desc}</li>`
    ).join("");

    // 特殊能力（全部）
    const abRows = abilities.map((a) => {
        const note = a.boost >= 0.9 ? "<span class=\"ab-strong\">超加速</span>"
            : a.boost >= 0.5 ? "<span class=\"ab-mid\">大きく加速</span>" : "加速";
        const demerit = a.penalty && a.penalty < 1 ? "・常に少し重い"
            : a.fizzle && a.fizzle < 1 ? "・不発の日は不振" : "";
        return `<tr>
            <td class="ab-name">⚡${a.label}</td>
            <td class="ab-proc">${Math.round(a.proc * 100)}%</td>
            <td>${a.desc}（${note}${demerit}）</td>
        </tr>`;
    }).join("");

    return [
        sec("🎮 基本ルール", `<ul>
            <li>お金はかけません。<b>ゲーム内コイン</b>を賭けて遊びます。</li>
            <li>8頭立て。出馬表で予想 → 馬券購入 → レース → 払い戻し、をくり返します。</li>
            <li>馬券は<b>残高の範囲で何枚でも</b>購入OK（同じ馬・違う式の併用も可）。</li>
            <li>誰かの残高が0になったら<b>最終ランキング</b>を表示して全員リセット。</li>
        </ul>`),

        sec("🎫 賭けの種類", `<ul class="guide-list">${betRows}</ul>
            <p class="guide-note">頭数が多い式・着順通りの式ほど当てづらく、配当（オッズ）は高くなります。</p>`),

        sec("💰 オッズの見方", `<ul>
            <li>当たったときの払い戻し ＝ <b>賭け金 × オッズ</b>。</li>
            <li>オッズは的中確率から計算（おおよそ <b>勝率 ≒ 0.8 ÷ 単勝オッズ</b>）。</li>
            <li>払戻率は80%（控除20%）。人気馬は低配当・穴馬は高配当。</li>
        </ul>`),

        sec("📊 ステータスの見方", `<ul>
            <li><b>スピード</b>：基礎能力。高いほど速い。</li>
            <li><b>スタミナ</b>：脚質由来。高いほど後半に強い。</li>
            <li><b>瞬発力</b>：特殊能力の最大加速の強さ。</li>
            <li>メーターは実際の走りを決める値そのもの＝<b>表示通りに走ります</b>。</li>
        </ul>
        <p class="guide-note">脚質：</p><ul class="guide-list">${styleRows}</ul>`),

        sec("⚡ 特殊能力（全種）", `<p class="guide-note">全馬が必ず1つ持ち、レース中に確率で発動します。
            発動しなくても出馬表には常に表示。発動率が低いほど当たれば大きい傾向。</p>
            <table class="ab-table"><thead><tr><th>能力</th><th>発動率</th><th>効果</th></tr></thead>
            <tbody>${abRows}</tbody></table>`),

        sec("🏆 勝つためのコツ", `<ul>
            <li>本命を厚く、穴を連系（馬連・3連単など）で薄く、の組み合わせが面白い。</li>
            <li><b>発動率の高い能力</b>（持久力・好スタート等）は計算が立てやすい。
                <b>怪物・一発</b>は低確率だがハマれば大荒れ＝穴の主役。</li>
            <li>大逃げ・ムラ脚など<b>デメリット持ち</b>は過信禁物。</li>
            <li>結果画面の「各賭け式の最適だった買い目」で、次の予想の参考に。</li>
        </ul>`),
    ].join("");
}
