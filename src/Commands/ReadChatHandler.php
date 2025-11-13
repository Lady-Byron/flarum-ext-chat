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

        // +++ 修复 (瑕疵 5 - 管理员 500 错误) +++
        // 原始代码:
        // $chatUser = $chat->getChatUser($actor); // <--- 这是 Bug！
        //
        // 修复：
        // 必须使用“安全”的 getMembership 方法
        $chatUser = $chat->getMembership($actor);
        // +++ 修复结束 +++
        
        // (已删除) 旧的检查
        // $actor->assertPermission($chatUser);

        // +++ 修复 (瑕疵 5 - 管理员 500 错误) +++
        // 如果 $chatUser 为 null (例如，管理员在围观, 没有 pivot 记录),
        // 我们不应该尝试更新 pivot。安静地返回。
        if (!$chatUser) {
            return $chat;
        }
        // +++ 修复结束 +++

        $time = new Carbon($readed_at);
        if ($chatUser->removed_at && $time > $chatUser->removed_at) $time = $chatUser->removed_at;
        $chat->users()->updateExistingPivot($actor->id, ['readed_at' => $time]);

        return $chat;
    }
}
