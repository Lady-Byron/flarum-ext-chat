<?php
/*
 * This file is part of xelson/flarum-ext-chat
 */

namespace Xelson\Chat;

class ChatSocket extends PusherWrapper
{
    /**
     * 前端监听的事件名（非频道名）
     */
    protected $channel = 'neonchat.events';

    /**
     * 对外事件入口：所有聊天类型都按成员分发
     */
    public function sendChatEvent($chat_id, $event_id, $options)
    {
        if (!$this->pusher()) {
            return;
        }

        $chat = Chat::findOrFail($chat_id);

        $attributes = [
            'event' => [
                'id'      => $event_id,
                'chat_id' => $chat_id,
            ],
            'response' => $options,
        ];

        // 统一走成员私有频道
        $this->sendPrivate($chat->id, $attributes);
    }

    /**
     * 向参与该聊天的所有有效成员的私有频道发送
     */
    public function sendPrivate($chat_id, $attributes)
    {
        $chatUsers = ChatUser::where('chat_id', $chat_id)
            ->whereNull('removed_at')
            ->pluck('user_id')
            ->all();

        foreach ($chatUsers as $user_id) {
            // Realtime 私有频道命名：private-user={ID}
            $this->pusher()->trigger('private-user=' . $user_id, $this->channel, $attributes);
        }
    }
}
