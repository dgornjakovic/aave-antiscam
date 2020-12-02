require("dotenv").config()
const Discord = require("discord.js")
const client = new Discord.Client();
const replaceString = require('replace-string');
const https = require('https');
var stringSimilarity = require('string-similarity');

var fs = require('fs');
let channel = null;
let otcChannel = null;
let users = null;
let allUsers = null;
let whitelistedUsers = ['715367020866306059', '747834144863551489'];
let allBannedUsers = null;
let bannedUsersMap = new Map();
let guild = null;
let sentWarnings = new Map();
let counter = 1;

const dateformat = require('dateformat');

const redis = require("redis");
let redisClient = null;
let messageCountMap = new Map();

let roles = ['754778454972432434', '754778200705466408', '765814464225476608'];

if (process.env.REDIS_URL) {
    //todo: use redis map to store message counts
    redisClient = redis.createClient(process.env.REDIS_URL);
    redisClient.on("error", function (error) {
        console.error(error);
    });

    redisClient.get("messageCountMap", function (err, obj) {
        messageCountMapRaw = obj;
        console.log("messageCountMapRaw:" + messageCountMapRaw);
        if (messageCountMapRaw) {
            messageCountMap = new Map(JSON.parse(messageCountMapRaw));
            console.log("gasSubscribersMap:" + messageCountMap);
        }
    });

    redisClient.get("sentWarnings", function (err, obj) {
        sentWarningsRaw = obj;
        console.log("sentWarningsRaw:" + sentWarningsRaw);
        if (sentWarningsRaw) {
            sentWarnings = new Map(JSON.parse(sentWarningsRaw));
            console.log("sentWarnings:" + sentWarnings);
        }
    });

}

let usersJoinedLast10Sec = new Array();

onReady();

onMessage();

onUpdate();

onJoin();

function onReady() {
    client.on("ready", () => {
        console.log(`Logged in as ${client.user.tag}!`)
        client.channels.cache.forEach(function (value, key) {
            if (key == '776883041427390494') {
                channel = value;
            }
            if (value.name == 'otc-trades-only') {
                otcChannel = value;
            }
        });
        let rawdata = fs.readFileSync('users.json');
        users = JSON.parse(rawdata);
        allUsers = users.team.members;

        client.guilds.cache.forEach(function (value, key) {
            if (value.name.toLowerCase().includes('yaxis')) {
                guild = value;
                guild.members.fetch().then(fetchedMembers => {
                    fetchedMembers.each(f => {
                        if (f._roles.length > 0) {
                            f._roles.forEach(r => {
                                if (roles.includes(r)) {
                                    if (!allUsers.flatMap(a => a.id).includes(f.id)) {
                                        let newMember = new Object();
                                        newMember.name = f.nickname ? f.nickname : f.user.username;
                                        newMember.id = f.id;
                                        allUsers.push(newMember);
                                    }
                                }
                            })
                        }
                    })
                });
                whitelistedUsers.forEach(w => {
                    guild.members.fetch(w).then(m => {
                        allUsers.push(m);
                    }).catch(e => "user not here");
                })

            }
        });


        if (process.env.RUN_FIRST) {

            client.guilds.cache.forEach(function (value, key) {
                if (value.name.toLowerCase().includes('yaxis')) {
                    guild = value;
                    guild.members.fetch().then(fetchedMembers => {
                        initialSweep(fetchedMembers);
                    });
                }
            });
        }

        if (process.env.RETROACTIVE_SWEEP) {
            doRetroactiveSweep();
        }

    });
}

async function initialSweep(members) {
    members.forEach(async function (m) {
        try {
            await delay(500);
            checkIsUserBanned(m.user.id, false, null, null, true);
            checkIsUserFlagged(m.user.id, false);
        } catch (e) {
            console.log(e);
        }
    });
}

function delay(time) {
    var newtime = counter * time;
    counter = counter + 1;
    return new Promise(function (resolve) {
        setTimeout(resolve, newtime)
    });
}

function onMessage() {
    client.on("message", msg => {
            try {

                var count = 0;
                if (messageCountMap.has(msg.author.id)) {
                    count = messageCountMap.get(msg.author.id);
                }
                messageCountMap.set(msg.author.id, count + 1);
                if (process.env.REDIS_URL) {
                    redisClient.set("messageCountMap", JSON.stringify([...messageCountMap]), function () {
                    });
                }

                checkIsUserBanned(msg.author.id, false, null, null, false)
                if (msg.channel == otcChannel) {
                    client.guilds.cache.forEach(function (value, key) {
                        if (value.name.toLowerCase().includes('yaxis')) {
                            guild.members.fetch(msg.author.id).then(m => {
                                let joinedTimestamp = m.joinedTimestamp;
                                let joinedDaysAgo = Date.now() - joinedTimestamp;
                                joinedDaysAgo = (((joinedDaysAgo / 1000) / 60) / 60) / 24;
                                joinedDaysAgo = Math.round(((joinedDaysAgo) + Number.EPSILON) * 100) / 100;
                                if (joinedDaysAgo < 7) {
                                    let messageToSend = "<@" + msg.author.id + ">  who wrote in OTC channel joined this server " + joinedDaysAgo + " days ago.";
                                    sendMessage(messageToSend);
                                }
                                console.log("User writing in otc channel joined:" + joinedDaysAgo + " ago.")
                            }).catch(e => "user not here");
                        }
                    });
                } else if (msg.content.toLowerCase().trim().replace(/ +(?= )/g, '').startsWith("!antiscam query")) {
                    try {
                        const args = msg.content.toLowerCase().trim().replace(/ +(?= )/g, '').slice("!antiscam".length).split(' ');
                        args.shift();
                        const command = args.shift().trim();
                        guild.members.fetch(command).then(m => {
                            try {
                                let joinedTimestamp = m.joinedTimestamp;

                                var messagecount = 0;
                                if (messageCountMap.has(command)) {
                                    messagecount = messageCountMap.get(command);
                                }
                                if (joinedTimestamp) {
                                    msg.channel.send("<@" + command + "> joined the server on "
                                        + dateformat(new Date(joinedTimestamp), 'dd.mm.yyyy.')
                                        + " and wrote " + messagecount + " total messages since the counting started on the 26.08.2020.");
                                } else {
                                    msg.channel.send("<@" + command + "> does not have the joined timestamp");
                                }
                                checkIsUserFlagged(command, true, null, msg.channel);
                                checkIsUserBanned(command, true, null, msg.channel);
                            } catch (e) {
                                console.log(e);
                            }
                        }).catch(e => console.log("user not here"));
                    } catch (e) {
                        console.log(e);
                    }
                } else {
                    client.guilds.cache.forEach(function (value, key) {
                        try {
                            if (value.name.toLowerCase().includes('yaxis')) {
                                let joinedTimestamp = value.members.cache.get(msg.author.id).joinedTimestamp;
                                let joinedHoursAgo = Date.now() - joinedTimestamp;
                                joinedHoursAgo = (((joinedHoursAgo / 1000) / 60));
                                joinedHoursAgo = Math.round(((joinedHoursAgo) + Number.EPSILON) * 100) / 100;
                                if (joinedHoursAgo < 30) {
                                    if (!msg.content.startsWith('>') &&
                                        msg.content.toLowerCase().includes("http") && !msg.content.toLowerCase().includes("defi")
                                        && !msg.content.toLowerCase().includes("yax")
                                        && !msg.content.toLowerCase().includes("pip")
                                        && !msg.content.toLowerCase().includes("team")
                                        && !msg.content.toLowerCase().includes("etherscan")
                                        && !msg.content.toLowerCase().includes("png")
                                        && !msg.content.toLowerCase().includes("jpg")
                                        && !msg.content.toLowerCase().includes("jpeg")
                                        && !msg.content.toLowerCase().includes("twitter")
                                        && !msg.content.toLowerCase().includes("bond")
                                        && !msg.content.toLowerCase().includes("youtu")
                                        && !msg.content.toLowerCase().includes("imgur")
                                        && !msg.content.toLowerCase().includes("gif") && !msg.content.toLowerCase().includes("tenor")) {
                                        let messageToSend = "<@" + msg.author.id + ">  joined less than an hour ago and sent a message with a link in channel: ***"
                                            + msg.channel.name + "***.\n " +
                                            "Message was: ***" + msg.content + "***";
                                        sendMessage(messageToSend);
                                        msg.delete({timeout: 5000 /*time unitl delete in milliseconds*/});
                                        setTimeout(function () {
                                            try {
                                                msg.member.kick('posting links under 1h in server');
                                                messageToSend = "<@" + msg.author.id + ">  has been kicked and messages were deleted.";
                                                sendMessage(messageToSend);
                                            } catch (e) {
                                                console.log(e);
                                            }
                                        }, 2000);
                                    }
                                }
                            }
                        } catch (e) {
                            console.log(e);
                        }
                    });
                }
            } catch (e) {
                console.log("Error occured on listening to  messages: " + e);
            }
        }
    );
}

function onJoin() {
    client.on("guildMemberAdd", function (member) {
        console.log("User joined");
        console.log(member);
        checkUserUpdateOnReservedWords(member);
        checkUserUpdateOnImpersonation(member);
        checkIsUserFlagged(member.user.id, false);
        checkIsUserBanned(member.user.id, false);
        usersJoinedLast10Sec.push(member);
    });
}

setInterval(function () {
    try {
        if (usersJoinedLast10Sec.length > 4) {
            let messageToSend = "Raid party detected with " + usersJoinedLast10Sec.length + " members";
            channel.send(messageToSend);
            usersJoinedLast10Sec.forEach(m => {
                let curMessageToSend = m.user.username + " is banned as a member of a raid party.";
                m.ban("Raid party");
                channel.send(curMessageToSend);
            });
        }
        usersJoinedLast10Sec = new Array();
    } catch (e) {
        console.log("Error occurred on antiraid logic", e);
    }
}, 1000 * 10);

function onUpdate() {

    client.on("guildMemberUpdate", function (oldMember, newMember) {
        try {
            var joined = oldMember.joinedTimestamp;
            var dif = (new Date()).getTime() - joined;

            var Seconds_from_T1_to_T2 = dif / 1000;
            var Seconds_Between_Dates = Math.abs(Seconds_from_T1_to_T2);
            if (Seconds_Between_Dates > 30) {

                checkUserUpdateOnReservedWords(newMember, oldMember);
                checkUserUpdateOnImpersonation(newMember, oldMember);
                checkIsUserFlagged(newMember.user.id, false, oldMember);
                checkIsUserBanned(newMember.user.id, false, oldMember);

            }
        } catch (e) {
            console.log("Error occurred on update logic", e);
        }
    });

}


function checkIsUserFlagged(id, printAnyway, oldMember, targetChannel) {
    https.get('https://node1.splyse.tech/watchlist', (resp) => {
        let data = '';

        // A chunk of data has been recieved.
        resp.on('data', (chunk) => {
            data += chunk;
        });

        // The whole response has been received. Print out the result.
        resp.on('end', () => {
            let result = JSON.parse(data);
            if (result.watchlist.includes(id)) {
                if (printAnyway) {
                    channel.send("<@" + id + "> is on the watchlist");
                } else if (oldMember) {
                    let messageToSend = "<@" + id + "> (updated) is on the watchlist";
                    sendMessage(messageToSend);
                } else {
                    let messageToSend = "<@" + id + "> (joined) is on the watchlist"
                    sendMessage(messageToSend);
                }
            }
        });

    }).on("error", (err) => {
        console.log("Error: " + err.message);
    });
}

function checkIsUserBanned(id, printAnyway, oldMember, targetChannel, isInitialSweep) {
    let isMember = false;
    allUsers.forEach(function (member) {
        if (member.id == id) {
            isMember = true;
        }
    })
    guild.members.fetch(id).then(m => {
        if (!m.user.bot && !isMember) {
            https.get('https://node1.splyse.tech/bans/' + id, (resp) => {
                    let data = '';

                    // A chunk of data has been recieved.
                    resp.on('data', (chunk) => {
                        data += chunk;
                    });

                    // The whole response has been received. Print out the result.
                    resp.on('end', () => {
                        let result = JSON.parse(data);
                        // only unique bans
                        if (((result.bancount > 0 && !initialSweep) || (result.bancount > 1 && initialSweep)) || printAnyway) {
                            if (printAnyway) {
                                let bannedServers = "";
                                result.details.forEach(function (server) {
                                    if (bannedServers != "") {
                                        bannedServers = bannedServers + ", ";
                                    }
                                    bannedServers = bannedServers + server.guildName;
                                });
                                let messageToSend = "<@" + id + "> has been banned on " + result.bancount + " servers so far: " + bannedServers +
                                    ". " + result.rangecount + " more users have been banned around this user.";
                                if (targetChannel) {
                                    targetChannel.send(messageToSend);
                                } else {
                                    channel.send(messageToSend);
                                }
                            } else if (oldMember) {
                                let bannedServers = "";
                                result.details.forEach(function (server) {
                                    if (bannedServers != "") {
                                        bannedServers = bannedServers + ", ";
                                    }
                                    bannedServers = bannedServers + server.guildName;
                                });
                                let messageToSend = "<@" + id + "> (updated) has been banned on " + result.bancount + " servers so far: " + bannedServers +
                                    ". " + result.rangecount + " more users have been banned around this user.";
                                if (targetChannel) {
                                    targetChannel.send(messageToSend);
                                } else {
                                    sendMessage(messageToSend, isInitialSweep);
                                }
                            } else {
                                let bannedServers = "";
                                result.details.forEach(function (server) {
                                    if (bannedServers != "") {
                                        bannedServers = bannedServers + ", ";
                                    }
                                    bannedServers = bannedServers + server.guildName;
                                });
                                let messageToSend = "<@" + id + "> (joined)  has been banned on " + result.bancount + " servers so far: " + bannedServers +
                                    ". " + result.rangecount + " more users have been banned around this user.";
                                if (targetChannel) {
                                    targetChannel.send(messageToSend);
                                } else {
                                    sendMessage(messageToSend, isInitialSweep);
                                }
                            }
                        }

                        let bannedServersCounter = new Set();
                        result.details.forEach(function (server) {
                            bannedServersCounter.add(server.guildName);
                        });
                        if (bannedServersCounter.size > 4) {
                            guild.members.fetch(id).then(m => {
                                let messageToSend = "<@" + id + "> has been automatically banned as he has more than 4 unique bans";
                                m.ban({days: 1, reason: "Auto banned"});
                                channel.send(messageToSend);
                            }).catch(e => console.log("user not here"));
                        } else {
                            if (result.bancount > 1 && result.rangecount > 15) {
                                guild.members.fetch(id).then(m => {
                                    let messageToSend = "<@" + id + "> has been automatically banned as he has at least 2 bans and more than 15 users banned in his range.";
                                    m.ban({days: 1, reason: "Auto banned"});
                                    channel.send(messageToSend);
                                }).catch(e => console.log("user not here"));
                            } else {
                                if (result.bancount > 0 && result.rangecount > 30) {
                                    guild.members.fetch(id).then(m => {
                                        let messageToSend = "<@" + id + "> has been automatically banned as he has at least 1 ban and more than 30 users banned in his range.";
                                        m.ban({days: 1, reason: "Auto banned"});
                                        channel.send(messageToSend);
                                    }).catch(e => console.log("user not here"));
                                }
                            }
                        }
                    });

                }
            ).on("error", (err) => {
                console.log("Error: " + err.message);
            });
        }
    });
}

function checkUserUpdateOnReservedWords(newMember, oldMember) {
    let isMember = false;
    allUsers.forEach(function (member) {
        if (member.id == newMember.user.id) {
            isMember = true;
        }
    })
    if (!isMember && !newMember.user.bot) {
        //'antiscam-bot-reports'
        let protectedKeywords = ["yaxis", "support"];
        protectedKeywords.forEach(protectedKeyword => {
            if (newMember.nickname && newMember.nickname.toLowerCase().includes(protectedKeyword)) {
                let messageToSend = "<@" + newMember.user.id + "> is trying to use nickname:" + newMember.nickname + " UserID: " + newMember.user.id
                sendMessage(messageToSend);
                if (oldMember) {
                    messageToSend = "His previous nickname was: " + oldMember.nickname + " and his previous username was: " + newMember.user.username;
                    sendMessage(messageToSend);
                }
            }
            if (newMember.user.username && newMember.user.username.toLowerCase().includes(protectedKeyword)) {
                let messageToSend = "<@" + newMember.user.id + "> is trying to use username:" + newMember.user.username + " UserID: " + newMember.user.id;
                sendMessage(messageToSend);
                if (oldMember) {
                    messageToSend = "His previous nickname was: " + oldMember.nickname + " and his previous username was: " + newMember.user.username;
                    sendMessage(messageToSend);
                }
            }
        });
    }
}

function checkUserUpdateOnImpersonation(newMember, oldMember) {
    let isMember = false;
    allUsers.forEach(function (member) {
        if (member.id == newMember.user.id) {
            isMember = true;
        }
    });
    if (!isMember && !newMember.user.bot) {
        //'antiscam-bot-reports'
        if (newMember.nickname && checkImpersonationOnName(newMember.nickname)) {
            let messageToSend = "<@" + newMember.user.id + "> is trying to use nickname:" + newMember.nickname + " UserID: " + newMember.user.id +
                ' which resembles the one from protected user:' + checkWhichImpersonationOnName(newMember.nickname);
            sendMessage(messageToSend);
            if (oldMember) {
                messageToSend = "His previous nickname was: " + oldMember.nickname + " and his previous username was: " + newMember.user.username;
                sendMessage(messageToSend);
            }
        }
        if (newMember.user.username && checkImpersonationOnName(newMember.user.username)) {
            let messageToSend = "<@" + newMember.user.id + "> is trying to use username:" + newMember.user.username + " UserID: " + newMember.user.id +
                ' which resembles the one from protected user:' + checkWhichImpersonationOnName(newMember.username);
            sendMessage(messageToSend);
            if (oldMember) {
                messageToSend = "His previous nickname was: " + oldMember.nickname + " and his previous username was: " + newMember.user.username;
                sendMessage(messageToSend);
            }
        }
        if (checkImpersonationOnAvatar(newMember.user.username)) {
            channel.send("<@" + newMember.user.id + "> is suspected for avatar impersonation.");
            sendMessage(messageToSend);
            if (oldMember) {
                messageToSend = "His previous nickname was: " + oldMember.nickname + " and his previous username was: " + newMember.user.username;
                sendMessage(messageToSend);
            }
        }
    }
}


function checkImpersonationOnName(newName) {
    let found = false;
    allUsers.forEach(function (user) {
        if (comparefullName(newName, user.name)) {
            found = true;
        }
    });
    return found;
}

function checkWhichImpersonationOnName(newName) {
    var toReturn = "";
    allUsers.forEach(function (user) {
        if (comparefullName(newName, user.name)) {
            toReturn = user.name;
        }
    });
    return toReturn;
}

function comparePlainName(newName, userName) {
    let name = newName.trim().split(" ")[0];
    name = name.trim().split("|")[0];
    name = name.replace(/\W/g, '');
    if (stringSimilarity.compareTwoStrings(name.toLowerCase(), userName.toLowerCase()) > 0.8) {
        return true;
    }
    return false;
}

function comparefullName(newName, userName) {
    if (stringSimilarity.compareTwoStrings(newName, userName) > 0.8) {
        return true;
    }
    if (stringSimilarity.compareTwoStrings(newName.toLowerCase(), userName.toLowerCase()) > 0.8) {
        return true;
    }
    if (stringSimilarity.compareTwoStrings(newName.toLowerCase().replace(/\W/g, ''), userName.toLowerCase().replace(/\W/g, '')) > 0.8) {
        return true;
    }
    return false;
}

function checkImpersonationOnAvatar(newName) {
    let found = false;
    allUsers.forEach(function (user) {

    });
    return found;
}

async function doRetroactiveSweep() {
    let allMembersArray = [];
    client.guilds.cache.forEach(function (value, key) {
        if (value.name.toLowerCase().includes('yaxis')) {
            guild = value;
            guild.members.fetch().then(fetchedMembers => {
                    doInnerRetroactiveSweep(fetchedMembers, allMembersArray);
                }
            );
        }
    });
}

async function doInnerRetroactiveSweep(fetchedMembers, allMembersArray) {
    fetchedMembers.forEach(m => {
        allMembersArray.push(m);
    });
    allMembersArray.sort(function (a, b) {
        return a.joinedTimestamp - b.joinedTimestamp;
    });
    var lastMember = allMembersArray[0];
    var raiders = [];
    for (let k = 1; k < allMembersArray.length; k++) {
        if ((allMembersArray[k].joinedTimestamp - lastMember.joinedTimestamp) / 1000 < 3) {
            if (raiders.length == 0) {
                raiders.push(lastMember);
            }
            raiders.push(allMembersArray[k]);
        } else {
            if (raiders.length > 4) {
                // channel.send("Retroactive raid found with " + raiders.length + " raiders");
                for (let k in raiders) {
                    let r = raiders[k];
                    await makeSynchronousRequest(r);
                }
            }
            raiders = [];
        }
        lastMember = allMembersArray[k];
    }
}

function getPromise(r) {
    return new Promise((resolve, reject) => {
        https.get('https://node1.splyse.tech/bans/' + r.user.id, (resp) => {
            let data = '';

            // A chunk of data has been recieved.
            resp.on('data', (chunk) => {
                data += chunk;
            });

            // The whole response has been received. Print out the result.
            resp.on('end', () => {
                let result = JSON.parse(data);
                let bannedServers = "";
                result.details.forEach(function (server) {
                    if (bannedServers != "") {
                        bannedServers = bannedServers + ", ";
                    }
                    bannedServers = bannedServers + server.guildName;
                });
                // let messageToSend = "<@" + r.user.id + "> has been banned on " + result.bancount + " servers so far: " + bannedServers +
                //     ". " + result.rangecount + " more users have been banned around this user.";
                // channel.send(messageToSend);
                r.ban("Retroactive raid party");
                channel.send("Raider <@" + r.user.id + "> joined at: " + dateformat(new Date(r.joinedTimestamp), 'dd.mm.yyyy. HH:MM:ss'));
                channel.send(r.user.username + " has been banned as member of a raid party");
                resolve(data);
            });

        }).on("error", (err) => {
            console.log("Error: " + err.message);
        });
    });
}

async function makeSynchronousRequest(r) {
    try {
        let http_promise = getPromise(r);
        let response_body = await http_promise;
    } catch (error) {
        console.log(error);
    }
}

function sendMessage(messageToSend, sendAnyway) {
    if (sendAnyway) {
        channel.send(messageToSend);
    } else {
        if (!sentWarnings.has(messageToSend)) {
            channel.send(messageToSend);
            sentWarnings.set(messageToSend, true);
            if (process.env.REDIS_URL) {
                redisClient.set("sentWarnings", JSON.stringify([...sentWarnings]), function () {
                });
            }
        }
    }
}

var mqtt = require('mqtt')
var mqttClient = mqtt.connect('mqtt://node1.splyse.tech')

mqttClient.on('connect', function () {
    try {
        mqttClient.subscribe('discord/bans', function (err) {
            if (!err) {
                console.log("connected to bans feed");
            }
        })
    } catch (e) {
        console.log(e);
    }
})

mqttClient.on('message', function (topic, message) {
    try {
        var ban = JSON.parse(message.toString());
        console.log("got a ban message: " + message.toString());
        if (!ban.guildName.toLowerCase().includes("yaxis")) {
            guild.members.fetch(ban.user.id).then(m => {
                channel.send("<@" + ban.user.id + "> has just been banned on " + ban.guildName);
                checkIsUserBanned(ban.user.id, true, null, null, false);
            }).catch(e => console.log("banned user is not here"));
        }
    } catch (e) {
        console.log(e);
    }
});


setInterval(function () {
    channel.send("Daily sweep started");
    client.guilds.cache.forEach(function (value, key) {
        if (value.name.toLowerCase().includes('yaxis')) {
            guild = value;
            guild.members.fetch().then(fetchedMembers => {
                initialSweep(fetchedMembers);
            });
        }
    });
}, 1000 * 60 * 60 * 24)

client.login(process.env.BOT_TOKEN)
