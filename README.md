# cohost.js
Unofficial API for cohost.org

## Install
```bash
npm i cohost
```

## Usage

```js
const cohost = require("cohost");

(async function() {
    // Create User and authenticate
    let user = new cohost.User();
    await user.login("YOUR_EMAIL", "YOUR_PASSWORD");

    // Get first Project of user
    let [ project ] = await user.getProjects();

    // Create Post
    await cohost.Post.create(project, {
        postState: 1,
        headline: "hello world from cohost.js",
        adultContent: false,
        blocks: [],
        cws: [],
        tags: [],
    });

    // Get Posts of Project
    let posts = await project.getPosts();
})();
```

## Features

Works:
 * Logging in
 * Getting the posts of a project
 * Creating a post

Doesn't work:
 * Editing a post: possible, haven't done it
 * Sharing a post: possible, haven't done it
 * Liking a post: possible, haven't done it
 * Getting notifications: possible, haven't done it
 * Uploading attachments: possible, haven't done it
 * Getting the home feed: possible, haven't done it
 * Editing profiles: possible, haven't done it
 * Getting followers and following: possible, haven't done it
 * Getting bookmarks and bookmarking: possible, haven't done it
 * Getting a post by its ID: **seems impossible? endpoint seems to be disabled**
 * Getting posts from a tag: haven''t checked
 * ...everything else
