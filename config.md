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
```
