<?php
/*
 * This file is part of xelson/flarum-ext-chat
 *
 * 修订说明：
 * - 原问题：Realtime 的私有频道命名为 `private-user={ID}`（带等号），
 * 但本类原实现为 `private-user{ID}`（不带等号）。Realtime 的 AuthController
 * 用正则 `^private-(?<subject>[a-z]+)=(?<id>[0-9]+)$` 做鉴权匹配——不带等号会导致鉴权失败或无法接收。
 * - 本次修改：仅修正频道名拼接，保持其它逻辑不变，以便最小侵入地接入 Realtime 的 Pusher 触发。
 *
 * --- 权限重构 (2025/11/11) ---
 * - 废除了 sendPublic() 方法，以满足“未加入公共频道的用户不应收到广播”的新权限需求。
 * - sendChatEvent() 现在总是调用 sendPrivate()。
 * - sendPrivate() 被升级，使其广播给：
 * 1. 所有活跃的频道成员。
 * 2. 所有 Flarum 论坛管理员（以满足“管理员隐身访问”的实时推送需求）。
 */

namespace Xelson\Chat;

// +++ 新增 Imports +++
use Flarum\Group\Group;
use Flarum\User\User;

class ChatSocket extends PusherWrapper
{
    /**
     * 事件名（非频道名），前端监听的自定义事件类型
     * Realtime 不关心事件名具体值，只负责转发
     */
    protected $channel = 'neonchat.events';

    /**
     * 统一对外的事件发送入口
     */
    public function sendChatEvent($chat_id, $event_id, $options)
    {
        if (!$this->pusher()) {
            return;
        }

        $chat = Chat::findOrFail($chat_id);

        $attributes = [
            'event' => [
                'id' => $event_id,
                'chat_id' => $chat_id,
            ],
            'response' => $options,
        ];

        // +++ 权限修改 +++
        // 无论频道类型 (public/private)，我们总是调用 sendPrivate。
        // sendPrivate 已被升级，会正确处理所有接收者（包括管理员）。
        if ($chat) {
            $this->sendPrivate($chat->id, $attributes);
        }
    }

    /**
     * (已删除) 向公共频道广播
     * public function sendPublic($attributes) ...
     */

    /**
     * 向参与该聊天的所有【活跃】用户【以及所有管理员】各自的私有频道发送
     */
    public function sendPrivate($chat_id, $attributes)
    {
        // 1. 获取所有活跃成员
        $chatUsersIds = ChatUser::where('chat_id', $chat_id)
            ->whereNull('removed_at')
            ->pluck('user_id')
            ->all();

        // 2. 获取所有论坛管理员
        // 我们需要确保 Group 和 User 模型被正确加载
        // 为了安全，我们假设 User 和 Group 模型是可用的
        try {
            $adminIds = User::whereHas('groups', function ($query) {
                $query->where('id', Group::ADMINISTRATOR_ID);
            })->pluck('id')->all();
        } catch (\Exception $e) {
            // 万一 User 或 Group 模型在此时不可用（不太可能），
            // 至少保证管理员不会收到推送，但功能不会完全崩溃
            $adminIds = [];
            // (可选: 在日志中记录错误 $e->getMessage())
        }

        // 3. 合并并去重
        $allReceiverIds = array_filter(array_unique(array_merge($chatUsersIds, $adminIds)));

        foreach ($allReceiverIds as $user_id) {
            // ★关键修正：Realtime 的私有频道命名必须是 'private-user={ID}'
            $this->pusher()->trigger('private-user=' . $user_id, $this->channel, $attributes);
        }
    }
}
