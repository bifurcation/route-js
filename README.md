route.js
========

A simple Node.JS script that uses the API on
[flightconnections.com](https://flightconnections.com) to compute
how challenging it is to fly a group of people to a meeting.

Input is a config file with the following values:

* `src`: An array of home cities / airports for meeting attendees
* `dst`: An array of candidate cities / airports for the meeting
* `businessClassThreshold`: A threshold time (in minutes) over which
  a meeting attendee might fly business class

Output is in CSV format; see the code for the semantics.

```
$ npm install
$ node route.js config.json >results.csv
```
