<?php
/*
 * This file is part of xelson/flarum-ext-chat
 */

namespace Xelson\Chat\Commands;

use Carbon\Carbon;
use Illuminate\Contracts\Bus\Dispatcher as BusDispatcher;
use Xelson\Chat\ChatRepository;
use Flarum\User\Exception\PermissionDeniedException;

class ReadChatHandler
{
    public function __construct(BusDispatcher $bus, ChatRepository $chats)
    {
        $this->bus = $bus;
        $this->chats = $chats;
    }

    public function handle(ReadChat $command)
    {
        $chat_id = $command->chat_id;
        $actor = $command->actor;
        $readed_at = $command->readed_at;

        $chat = $this->chats->findOrFail($chat_id, $actor);

        $chatUser = $chat->getChatUser($actor);

        // 仅“有效成员”可写已读；管理员非成员仅旁观，不写任何已读
        if (!$chatUser || $chatUser->removed_at) {
            throw new PermissionDeniedException();
        }

        $time = new Carbon($readed_at);

        // 若设置了 removed_at，已退出成员本不该走到这里；为稳妥仍夹上界
        if ($chatUser->removed_at && $time > $chatUser->removed_at) {
            $time = $chatUser->removed_at;
        }

        $chat->users()->updateExistingPivot($actor->id, ['readed_at' => $time]);

        return $chat;
    }
}

