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
```