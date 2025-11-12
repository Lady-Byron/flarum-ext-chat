<?php
/*
 * This file is part of xelson/flarum-ext-chat
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Xelson\Chat\Commands;

use Carbon\Carbon;
use Illuminate\Contracts\Bus\Dispatcher as BusDispatcher;
use Xelson\Chat\ChatRepository;
use Flarum\User\Exception\PermissionDeniedException;

class ReadChatHandler
{

    /**
     * @param BusDispatcher $bus
     */
    public function __construct(BusDispatcher $bus, ChatRepository $chats)
    {
        $this->bus = $bus;
        $this->chats = $chats;
    }

    /**
     * Handles the command execution.
     *
     * @param ReadChat $command
     * @return null|string
     */
    public function handle(ReadChat $command)
    {
        $chat_id = $command->chat_id;
        $actor = $command->actor;
        $readed_at = $command->readed_at;

        $chat = $this->chats->findOrFail($chat_id, $actor);

        // +++ 新增：核心“读”权限检查 +++
        if (!$chat->canAccessContent($actor)) {
            throw new PermissionDeniedException();
        }

        $chatUser = $chat->getChatUser($actor);

        $time = new Carbon($readed_at);
        if ($chatUser->removed_at && $time > $chatUser->removed_at) $time = $chatUser->removed_at;
        $chat->users()->updateExistingPivot($actor->id, ['readed_at' => $time]);

        return $chat;
    }
}
