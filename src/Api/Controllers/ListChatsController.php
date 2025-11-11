<?php
/*
 * This file is part of xelson/flarum-ext-chat
 */

namespace Xelson\Chat\Api\Controllers;

use Xelson\Chat\Api\Serializers\ChatUserSerializer;
use Xelson\Chat\ChatRepository;
use Illuminate\Support\Arr;
use Tobscure\JsonApi\Document;
use Illuminate\Contracts\Bus\Dispatcher;
use Psr\Http\Message\ServerRequestInterface;
use Flarum\Api\Controller\AbstractListController;

class ListChatsController extends AbstractListController
{
    public $serializer = ChatUserSerializer::class;

    public $include = [
        'creator',
        'users',
        'last_message',
        'last_message.user',
        'first_message'
    ];

    protected $bus;
    protected $chats;

    public function __construct(Dispatcher $bus, ChatRepository $chats)
    {
        $this->bus = $bus;
        $this->chats = $chats;
    }

    protected function data(ServerRequestInterface $request, Document $document)
    {
        $actor = $request->getAttribute('actor');
        $include = $this->extractInclude($request);
        $scope = Arr::get($request->getQueryParams(), 'scope'); // 管理员可用 '?scope=all'

        return $this->chats->queryVisible($actor, $scope)->get()->load($include);
    }
}
