<?php
/*
 * This file is part of xelson/flarum-ext-chat
 *
 * 修订说明：
 * - 原问题：Realtime 的私有频道命名为 `private-user={ID}`（带等号），
 *   但本类原实现为 `private-user{ID}`（不带等号）。Realtime 的 AuthController
 *   用正则 `^private-(?<subject>[a-z]+)=(?<id>[0-9]+)$` 做鉴权匹配——不带等号会导致鉴权失败或无法接收。
 * - 本次修改：仅修正频道名拼接，保持其它逻辑不变，以便最小侵入地接入 Realtime 的 Pusher 触发。
 */

namespace Xelson\Chat;

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

        // 公共频道（type=1）→ 发到 'public'
        // 私有会话（type=0）→ 发到每个成员的 'private-user={ID}'
        if ($chat) {
            $chat->type ? $this->sendPublic($attributes) : $this->sendPrivate($chat->id, $attributes);
        }
    }

    /**
     * 向公共频道广播
     */
    public function sendPublic($attributes)
    {
        // Realtime 约定公共频道名为 'public'
        $this->pusher()->trigger('public', $this->channel, $attributes);
    }

    /**
     * 向参与该聊天的所有在线用户各自的私有频道发送
     */
    public function sendPrivate($chat_id, $attributes)
    {
        $chatUsers = ChatUser::where('chat_id', $chat_id)
            ->whereNull('removed_at')
            ->pluck('user_id')
            ->all();

        foreach ($chatUsers as $user_id) {
            // ★关键修正：Realtime 的私有频道命名必须是 'private-user={ID}'
            $this->pusher()->trigger('private-user=' . $user_id, $this->channel, $attributes);
        }
    }
}
