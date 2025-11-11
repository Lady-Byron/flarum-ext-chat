<?php
/*
 * This file is part of xelson/flarum-ext-chat
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Xelson\Chat\Commands;

use Carbon\Carbon;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Support\Arr;
use Xelson\Chat\ChatRepository;
use Xelson\Chat\Event\Message\Saved;
use Xelson\Chat\Message;
use Xelson\Chat\MessageValidator;
use Flarum\Foundation\ValidationException;

class PostMessageHandler
{
    /**
     * @var MessageValidator
     */
    protected $validator;

    /**
     * @var ChatRepository
     */
    protected $chats;

    /**
     * @var Dispatcher
     */
    protected $events;

    /**
     * @param MessageValidator $validator
     * @param ChatRepository   $chats
     * @param Dispatcher       $events
     */
    public function __construct(
        MessageValidator $validator,
        ChatRepository $chats,
        Dispatcher $events
    ) {
        $this->validator = $validator;
        $this->chats = $chats;
        $this->events  = $events;
    }

    /**
     * Handles the command execution.
     *
     * @param  PostMessage $command
     * @return Message
     * @throws \Throwable
     */
    public function handle(PostMessage $command)
    {
        $actor = $command->actor;
        $data  = $command->data ?: [];
        $ip    = $command->ip_address;

        // ---- 兼容多来源取值 ---------------------------------------------------
        // message: 优先 JSON:API attributes.message，兜底顶层 message
        $content = Arr::get($data, 'attributes.message')
            ?? Arr::get($data, 'message')
            ?? '';

        // chat_id: 兼容 attributes.chat_id / relationships.chat.data.id / 顶层 chat_id / 路由 id
        $chatId = Arr::get($data, 'attributes.chat_id')
            ?? Arr::get($data, 'relationships.chat.data.id')
            ?? Arr::get($data, 'chat_id')
            ?? Arr::get($data, 'id'); // 当使用 /chatmessages/{id} 样式路由时由控制器注入

        if (!$chatId) {
            throw new ValidationException(['chat_id' => 'Required']);
        }

        $chatId = (int) $chatId;

        // ----------------------------------------------------------------------

        // 找到会话（非管理员仅能访问可见会话）
        $chat = $this->chats->findOrFail($chatId, $actor);

        // 需要具备“聊天发言”站点权限
        $actor->assertCan('xelson-chat.permissions.chat');

        // 必须是会话成员、且未移除
        $chatUser = $chat->getChatUser($actor);
        $actor->assertPermission($chatUser && !$chatUser->removed_at);

        // 构建并校验消息
        $message = Message::build(
            (string) $content,
            $actor->id,
            Carbon::now(),
            $chat->id,
            $ip
        );

        $this->validator->assertValid($message->getDirty());

        // 保存消息
        $message->save();

        // 写入“已读到当前”时间
        $chat->users()->updateExistingPivot($actor->id, ['readed_at' => Carbon::now()]);

        // 触发事件（用于广播/通知）
        $this->events->dispatch(
            new Saved($message, $actor, $data, true)
        );

        return $message;
    }
}

