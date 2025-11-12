<?php

namespace Xelson\Chat\Commands;

use Illuminate\Contracts\Events\Dispatcher;
use Xelson\Chat\ChatRepository;
use Xelson\Chat\Event\Message\Deleting;
use Xelson\Chat\MessageRepository;
use Flarum\User\Exception\PermissionDeniedException;

class DeleteMessageHandler
{
    protected MessageRepository $messages;
    protected ChatRepository $chats;
    protected Dispatcher $events;

    public function __construct(MessageRepository $messages, ChatRepository $chats, Dispatcher $events)
    {
        $this->messages = $messages;
        $this->chats    = $chats;
        $this->events   = $events;
    }

    /**
     * @param DeleteMessage $command
     * @return mixed
     */
    public function handle(DeleteMessage $command)
    {
        $messageId = $command->id;
        $actor     = $command->actor;

        $message = $this->messages->findOrFail($messageId);

        // 非系统消息才能被删除
        $actor->assertPermission(!$message->type);

        $chat     = $this->chats->findOrFail($message->chat_id, $actor);

        // +++ 新增：核心“删除”权限检查 +++
        if (!$chat->canAccessContent($actor)) {
            throw new PermissionDeniedException();
        }
        // +++ 检查结束 +++
        
        $chatUser = $chat->getChatUser($actor);

        // 仅参与者且具备相应角色才能删除
        $actor->assertPermission($chatUser && $chatUser->role != 0);

        $this->events->dispatch(new Deleting($message, $actor));

        // ORIGINAL ISSUE: 先 $message->delete()，然后再设置 $message->deleted_by / deleted_forever。
        // 这在非 SoftDeletes 情况下不会被持久化，等同于无效写入，且可能误导调用方。
        // FIX: 保持“永久删除”语义，仅执行 delete()；若日后改为“软删”，应在模型启用 SoftDeletes 并改造查询与序列化。
        $message->delete();

        // 返回被删除的模型实例（仍含内存中的属性，供当前响应序列化使用）
        return $message;
    }
}

