---
title: Admin 插件配置
description: 配置Bot管理插件的通知和功能选项
fields:
  - key: base.notifyTarget
    label: 通知目标
    type: multi-select
    source: qq_friends
    description: 选择接收通知的主人QQ号，空为全部主人都发送
    placeholder: 选择通知目标

  - key: base.notifyFriendMsg
    label: 好友消息通知
    type: switch
    description: 收到好友私聊消息时通知主人

  - key: base.notifyFriendRequest
    label: 好友申请通知
    type: switch
    description: 收到好友申请时通知主人

  - key: base.notifyGroupInvite
    label: 群邀请通知
    type: switch
    description: 收到群邀请时通知主人

  - key: base.notifyGroupBan
    label: Bot被禁言通知
    type: switch
    description: Bot被禁言时通知主人

  - key: base.notifyGroupUnban
    label: Bot解除禁言通知
    type: switch
    description: Bot被解除禁言时通知主人

  - key: base.notifyGroupKick
    label: Bot被踢通知
    type: switch
    description: Bot被踢出群聊时通知主人

  - key: base.welcome.enabled
    label: 启用新人入群欢迎
    type: switch
    description: 新人（非机器人）入群时发送欢迎消息

  - key: base.welcome.mode
    label: 欢迎模式
    type: select
    options:
      - value: ai
        label: 使用AI生成
      - value: text
        label: 固定文本
    description: AI 模式由 chat-runtime 模型生成；text 模式直接套用固定欢迎模板

  - key: base.welcome.text
    label: 固定欢迎文本
    type: textarea
    description: 欢迎模板，支持 {user} 和 {group} 占位符
    placeholder: 欢迎新人～

  - key: base.welcome.aiPrompt
    label: AI欢迎额外提示词
    type: textarea
    description: 作为额外要求传给模型，默认留空即可
    placeholder: 例如：提醒新成员查看群公告

  - key: base.welcome.batchWindowMs
    label: AI 欢迎聚合窗口 (毫秒)
    type: number
    description: 短时间内多个新成员入群时，攒齐该时长内的成员后只发一次 AI 欢迎，避免频繁调用模型。设为 0 表示关闭聚合、逐个欢迎。默认 20000。
    placeholder: 20000

  - key: verify.groups
    label: 各群入群验证配置
    type: json
    description: 每个群的验证配置数组，元素形如 {"groupId":123,"enabled":true,"mode":"reaction"}。推荐通过 /开启验证、/关闭验证、/切换验证模式 指令管理，直接编辑需填写合法 JSON 数组。
    placeholder: '[]'

  - key: verify.reactionEmojiId
    label: 回应模式表态表情ID
    type: text
    description: 回应验证模式下，Bot 给提示消息添加的表态表情 ID，新成员点击该表态即通过验证。默认 424。
    placeholder: "424"

  - key: verify.reactionDelayMs
    label: 回应模式延迟 (毫秒)
    type: number
    description: 回应模式下新成员入群后，Bot 等待多久再 @新成员发出验证提示并添加表态。默认 3000。重新验证指令不受此延迟影响。
    placeholder: 3000

  - key: verify.verifyTimeoutMs
    label: 验证超时 (毫秒)
    type: number
    description: 新成员未在此时长内完成验证则视为超时，按下方配置决定是否踢出。默认 120000（2分钟）。
    placeholder: 120000

  - key: verify.reactionPrompt
    label: 回应模式提示语
    type: textarea
    description: 回应模式下 @新成员 时发送的提示文本。
    placeholder: 新来的小伙伴请在2分钟内点击下方红色按钮完成验证 不听话会被移出群聊喵~

  - key: verify.numberPrompt
    label: 数字模式提示语
    type: textarea
    description: 数字模式下的提示文本，支持 {question} 占位符替换算术题。
    placeholder: '新来的小伙伴请在2分钟内回答下面的算术题完成验证，答错或发无关消息会被移出群聊喵~ 题目：{question}'

  - key: verify.maxInvalidMessages
    label: 最大无关消息数
    type: number
    description: 未验证成员发送与验证无关的消息达到该次数后踢出群聊。默认 5。
    placeholder: 5

  - key: verify.kickOnFail
    label: 达到上限踢出
    type: switch
    description: 未验证成员无关消息达到上限时是否踢出群聊

  - key: verify.kickOnTimeout
    label: 超时踢出
    type: switch
    description: 新成员验证超时是否踢出群聊

---

```mioku-fields
keys:
  - base.notifyTarget
  - base.notifyFriendMsg
  - base.notifyFriendRequest
  - base.notifyGroupInvite
  - base.notifyGroupBan
  - base.notifyGroupUnban
  - base.notifyGroupKick
  - base.welcome.enabled
  - base.welcome.mode
  - base.welcome.text
  - base.welcome.aiPrompt
  - base.welcome.batchWindowMs
  - verify.groups
  - verify.reactionEmojiId
  - verify.reactionDelayMs
  - verify.verifyTimeoutMs
  - verify.reactionPrompt
  - verify.numberPrompt
  - verify.maxInvalidMessages
  - verify.kickOnFail
  - verify.kickOnTimeout
```